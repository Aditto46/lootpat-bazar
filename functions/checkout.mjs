// Checkout, order creation and order lookup. Every amount is recomputed from
// database rows: the request carries product ids and quantities, never prices.
// Stock is reserved with compare-and-swap updates and restored if any later
// write fails, so the catalog can never drift from a persisted order.
import { AppError, clientIp, json, readJson, rows, secureCompare } from "./http.mjs";
import { consume } from "./limiter.mjs";
import { gatewayAvailability } from "./payment-providers.mjs";
import { sendOrderSms } from "./sms.mjs";
import { ORDER_NUMBER_PATTERN, checkoutSchema, couponValidateSchema, parse, trackOrderSchema } from "./validate.mjs";

export const ORDER_COLUMNS =
  "id,order_number,lookup_token,idempotency_key,user_id,status,payment_method,payment_status,courier,tracking_number,courier_status,shipped_at,customer_name,phone,email,district_id,district_name_bn,district_name_en,division_name_bn,division_name_en,address,area,note,subtotal_paisa,discount_paisa,shipping_paisa,total_paisa,coupon_code,marketing_consent,created_at";
const PRODUCT_COLUMNS = "id,slug,name_bn,name_en,price_paisa,stock,status,image,image_small,deleted_at";
const VARIANT_COLUMNS = "id,product_id,sku,option_label_bn,option_label_en,price_paisa,stock";
export const ITEM_COLUMNS =
  "id,order_id,position,product_id,product_slug,variant_id,sku,name_bn,name_en,variant_label_bn,variant_label_en,unit_price_paisa,qty,line_total_paisa,image";
export const HISTORY_COLUMNS = "id,order_id,status,created_at";

const DEFAULT_SETTINGS = {
  "store.name_bn": "লুটপাট বাজার",
  "store.name_en": "LootPat Bazar",
  "store.phone": "+8801410286822",
  "store.email": "adittoo2026@gmail.com",
  "store.address_bn": "পুরান ঢাকা, বাংলাদেশ-১১০০",
  "store.address_en": "Old Dhaka, Bangladesh 1100",
  "store.trade_license": "",
  "store.tin": "",
  "delivery.dhaka_charge_paisa": "6000",
  "delivery.outside_charge_paisa": "12000",
  "delivery.free_threshold_paisa": "200000",
  "delivery.cod_limit_paisa": "1000000",
  "delivery.cod_enabled": "true",
  "payments.bkash_enabled": "true",
  "payments.nagad_enabled": "true",
  "payments.sslcommerz_enabled": "false",
  "store.payment_number": "01410286822",
};

const ORDER_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

const newId = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

function rateLimited(result) {
  const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  return json({ error: "rate_limited" }, 429, { "retry-after": String(seconds) });
}

async function limit(db, scope, subject) {
  const result = await consume(db, scope, subject);
  return result.allowed ? null : rateLimited(result);
}

export async function readSettings(db) {
  const stored = rows(await db.from("settings").select("key,value").limit(200));
  const values = new Map(Object.entries(DEFAULT_SETTINGS));
  for (const row of stored) {
    if (typeof row.key === "string" && typeof row.value === "string") values.set(row.key, row.value);
  }
  const text = (key) => values.get(key) ?? "";
  const integer = (key) => {
    const parsed = Number(values.get(key));
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : Number(DEFAULT_SETTINGS[key]);
  };
  const flag = (key) => values.get(key) === "true";

  return {
    store: {
      name: { bn: text("store.name_bn"), en: text("store.name_en") },
      phone: text("store.phone"),
      email: text("store.email"),
      address: { bn: text("store.address_bn"), en: text("store.address_en") },
      tradeLicense: text("store.trade_license"),
      tin: text("store.tin"),
      paymentNumber: text("store.payment_number"),
    },
    delivery: {
      dhakaPaisa: integer("delivery.dhaka_charge_paisa"),
      outsidePaisa: integer("delivery.outside_charge_paisa"),
      freeThresholdPaisa: integer("delivery.free_threshold_paisa"),
      codLimitPaisa: integer("delivery.cod_limit_paisa"),
      codEnabled: flag("delivery.cod_enabled"),
    },
    payments: {
      cod: flag("delivery.cod_enabled"),
      wallet: text("store.payment_number") !== "",
      bkash: flag("payments.bkash_enabled"),
      nagad: flag("payments.nagad_enabled"),
      sslcommerz: flag("payments.sslcommerz_enabled"),
    },
    security: {
      ipAllowlist: text("security.admin_ip_allowlist"),
      requireTwoFactor: values.get("security.require_two_factor") !== "false",
    },
  };
}

export async function handleCheckoutConfig(db, env) {
  const settings = await readSettings(db);
  const gateways = gatewayAvailability(settings, env);
  return json({
    ...settings,
    payments: {
      cod: settings.delivery.codEnabled,
      wallet: settings.payments.wallet,
      bkash: gateways.providers.bkash.available,
      nagad: gateways.providers.nagad.available,
      sslcommerz: gateways.providers.sslcommerz.available,
    },
    gateway: {
      mode: gateways.mode,
      providers: gateways.providers,
    },
  });
}

function isDhakaDistrict(row) {
  return row.name_en.trim().toLowerCase() === "dhaka";
}

function shippingFor(settings, district, subtotalPaisa, freeShipping) {
  if (freeShipping || subtotalPaisa >= settings.delivery.freeThresholdPaisa) return 0;
  return isDhakaDistrict(district)
    ? settings.delivery.dhakaPaisa
    : settings.delivery.outsidePaisa;
}

function couponDiscount(coupon, subtotalPaisa) {
  if (coupon.kind === "percent") {
    const raw = Math.floor((subtotalPaisa * coupon.value) / 100);
    return coupon.max_discount_paisa ? Math.min(raw, coupon.max_discount_paisa) : raw;
  }
  if (coupon.kind === "fixed") return Math.min(coupon.value, subtotalPaisa);
  return 0;
}

const couponRejection = (reason, extra = {}) =>
  json({ error: "coupon_invalid", reason, ...extra }, 409);

// Coupon rules are checked against the database, not against the cart. The
// client's subtotal is used only to preview a discount.
async function evaluateCoupon(db, code, subtotalPaisa, phone) {
  const normalized = code.trim().toUpperCase();
  const found = rows(await db.from("coupons").select("*").eq("code", normalized).limit(1));
  if (found.length !== 1) return { error: couponRejection("unknown") };

  const coupon = found[0];
  const now = Date.now();
  if (!coupon.active) return { error: couponRejection("inactive") };
  if (coupon.starts_at && Date.parse(coupon.starts_at) > now) return { error: couponRejection("not_started") };
  if (coupon.ends_at && Date.parse(coupon.ends_at) < now) return { error: couponRejection("expired") };
  if (subtotalPaisa < coupon.min_subtotal_paisa) {
    return {
      error: couponRejection("min_subtotal", { minSubtotalPaisa: coupon.min_subtotal_paisa }),
    };
  }

  const redemptions = rows(
    await db.from("coupon_redemptions").select("phone").eq("coupon_id", coupon.id).limit(5000),
  );
  if (coupon.usage_limit !== null && redemptions.length >= coupon.usage_limit) {
    return { error: couponRejection("usage_limit") };
  }
  if (phone && coupon.per_customer_limit !== null) {
    const used = redemptions.filter((row) => row.phone === phone).length;
    if (used >= coupon.per_customer_limit) return { error: couponRejection("already_used") };
  }

  return {
    coupon,
    discountPaisa: couponDiscount(coupon, subtotalPaisa),
    freeShipping: coupon.kind === "free_shipping",
  };
}

export async function handleCouponValidate(db, request) {
  const limited = await limit(db, "coupon", clientIp(request));
  if (limited) return limited;

  const body = parse(couponValidateSchema, await readJson(request));
  const result = await evaluateCoupon(db, body.code, body.subtotalPaisa, null);
  if (result.error) return result.error;

  return json({
    coupon: {
      code: result.coupon.code,
      kind: result.coupon.kind,
      value: result.coupon.value,
      minSubtotalPaisa: result.coupon.min_subtotal_paisa,
      maxDiscountPaisa: result.coupon.max_discount_paisa ?? null,
    },
    discountPaisa: result.discountPaisa,
    freeShipping: result.freeShipping,
  });
}

function randomOrderNumber() {
  const dhaka = new Date(Date.now() + DHAKA_OFFSET_MS);
  const stamp = [
    String(dhaka.getUTCFullYear()).slice(2),
    String(dhaka.getUTCMonth() + 1).padStart(2, "0"),
    String(dhaka.getUTCDate()).padStart(2, "0"),
  ].join("");
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const suffix = Array.from(bytes, (byte) => ORDER_ALPHABET[byte % ORDER_ALPHABET.length]).join("");
  return `LP-${stamp}-${suffix}`;
}

function orderItem(row) {
  return {
    productId: row.product_id,
    productSlug: row.product_slug,
    variantId: row.variant_id ?? null,
    sku: row.sku,
    name: { bn: row.name_bn, en: row.name_en },
    variantLabel:
      row.variant_label_bn && row.variant_label_en
        ? { bn: row.variant_label_bn, en: row.variant_label_en }
        : null,
    unitPricePaisa: row.unit_price_paisa,
    qty: row.qty,
    lineTotalPaisa: row.line_total_paisa,
    image: row.image,
  };
}

export function publicOrder(row, items, history) {
  return {
    orderNumber: row.order_number,
    status: row.status,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    customer: {
      name: row.customer_name,
      phone: row.phone,
      email: row.email ?? null,
      district: {
        id: row.district_id,
        name: { bn: row.district_name_bn, en: row.district_name_en },
        division: { bn: row.division_name_bn, en: row.division_name_en },
      },
      address: row.address,
      area: row.area ?? null,
      note: row.note ?? null,
      marketingConsent: Boolean(row.marketing_consent),
    },
    items: [...items]
      .sort((left, right) => left.position - right.position)
      .map(orderItem),
    totals: {
      subtotalPaisa: row.subtotal_paisa,
      discountPaisa: row.discount_paisa,
      shippingPaisa: row.shipping_paisa,
      totalPaisa: row.total_paisa,
    },
    couponCode: row.coupon_code ?? null,
    createdAt: row.created_at,
    statusHistory: [...history]
      .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)))
      .map((entry) => ({ status: entry.status, at: entry.created_at })),
    fulfilment: {
      courier: row.courier ?? null,
      trackingNumber: row.tracking_number ?? null,
      courierStatus: row.courier_status ?? null,
      shippedAt: row.shipped_at ?? null,
    },
    paymentSession: null,
  };
}

export async function loadOrderDetail(db, row) {
  const items = rows(
    await db.from("order_items").select(ITEM_COLUMNS).eq("order_id", row.id).limit(50),
  );
  const history = rows(
    await db
      .from("order_status_history")
      .select(HISTORY_COLUMNS)
      .eq("order_id", row.id)
      .limit(50),
  );
  const detail = publicOrder(row, items, history);

  try {
    const sessions = rows(
      await db
        .from("payment_sessions")
        .select("id,provider,status,amount_paisa,provider_ref,expires_at,created_at")
        .eq("order_id", row.id)
        .limit(5),
    ).sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
    const latest = sessions[0];
    if (latest) {
      detail.paymentSession = {
        id: latest.id,
        provider: latest.provider,
        status: latest.status,
        amountPaisa: latest.amount_paisa,
        providerRef: latest.provider_ref ?? null,
        expiresAt: latest.expires_at,
        createdAt: latest.created_at,
      };
    }
  } catch {
    /* an order stays readable if the payment tables are not migrated yet */
  }

  return detail;
}

async function findByNumber(db, orderNumber) {
  if (!ORDER_NUMBER_PATTERN.test(orderNumber)) throw new AppError("order_not_found", 404);
  const found = rows(
    await db.from("orders").select(ORDER_COLUMNS).eq("order_number", orderNumber).limit(1),
  );
  if (found.length !== 1) throw new AppError("order_not_found", 404);
  return found[0];
}

function orderResponse(row, detail, lookupToken) {
  return lookupToken ? { order: detail, lookupToken } : { order: detail };
}

async function applyReservation(db, step) {
  const patch = step.table === "products"
    ? { stock: step.stock - step.qty, updated_at: nowIso() }
    : { stock: step.stock - step.qty };
  const updated = rows(
    await db
      .from(step.table)
      .update(patch)
      .eq("id", step.id)
      .eq("stock", step.stock)
      .select("id"),
  );
  return updated.length === 1;
}

// Reservations belong to one request only. The pending list is unwound in
// reverse order if a line or any later order write fails.
async function restoreStock(db, pending) {
  const steps = pending.splice(0).reverse();
  for (const step of steps) {
    try {
      await db
        .from(step.table)
        .update({ stock: step.stock })
        .eq("id", step.id)
        .select("id");
    } catch {
      /* a later staff stock adjustment will reconcile this line */
    }
  }
}

async function reserveLine(db, line, productStock, pending) {
  if (line.variant) {
    const variantStep = {
      table: "product_variants",
      id: line.variant.id,
      qty: line.qty,
      stock: line.variant.stock,
    };
    if (!(await applyReservation(db, variantStep))) return false;
    pending.push({ table: variantStep.table, id: variantStep.id, stock: variantStep.stock });
  }

  const expected = productStock.get(line.product.id) ?? line.product.stock;
  const productStep = { table: "products", id: line.product.id, qty: line.qty, stock: expected };
  if (!(await applyReservation(db, productStep))) return false;
  productStock.set(line.product.id, expected - line.qty);
  pending.push({ table: "products", id: line.product.id, stock: expected });
  return true;
}

// Flash-sale prices are resolved on the server so the sale cannot be spoofed by
// a client price. Only an active, in-window sale contributes.
async function flashPrices(db) {
  const now = Date.now();
  const sale = rows(await db.from("flash_sales").select("*").limit(20)).find(
    (row) =>
      row.status === "active" &&
      Date.parse(row.starts_at) <= now &&
      Date.parse(row.ends_at) > now,
  );
  if (!sale) return new Map();
  const items = rows(
    await db.from("flash_sale_items").select("*").eq("sale_id", sale.id).limit(50),
  );
  return new Map(
    items
      .filter((item) => Number.isSafeInteger(item.sale_price_paisa) && item.sale_price_paisa > 0)
      .map((item) => [item.product_id, item.sale_price_paisa]),
  );
}

export async function handleCreateOrder(db, request, userId, context) {
  const ip = clientIp(request);
  const ipLimit = await limit(db, "checkout", ip);
  if (ipLimit) return ipLimit;

  const body = parse(checkoutSchema, await readJson(request));
  const phoneLimit = await limit(db, "checkout_phone", body.customer.phone);
  if (phoneLimit) return phoneLimit;

  // A blocked phone cannot place orders; the admin blocklist is the source of
  // truth because guests have no account row to suspend.
  const blocked = rows(
    await db
      .from("customer_blocks")
      .select("phone,active")
      .eq("phone", body.customer.phone)
      .eq("active", true)
      .limit(1),
  );
  if (blocked.length > 0) return json({ error: "customer_blocked" }, 403);

  if (body.idempotencyKey) {
    const existing = rows(
      await db
        .from("orders")
        .select(ORDER_COLUMNS)
        .eq("idempotency_key", body.idempotencyKey)
        .limit(1),
    );
    if (existing.length === 1 && existing[0].phone === body.customer.phone) {
      return json(orderResponse(existing[0], await loadOrderDetail(db, existing[0]), existing[0].lookup_token));
    }
  }

  const settings = await readSettings(db);
  const gateways = gatewayAvailability(settings, context.env);
  if (body.paymentMethod === "cod") {
    if (!settings.delivery.codEnabled) {
      return json({ error: "payment_method_unavailable", method: "cod" }, 409);
    }
  } else if (body.paymentMethod === "wallet") {
    if (!settings.payments.wallet) {
      return json({ error: "payment_method_unavailable", method: "wallet" }, 409);
    }
  } else if (!gateways.providers[body.paymentMethod]?.available) {
    return json({ error: "payment_method_unavailable", method: body.paymentMethod }, 409);
  }

  const districts = rows(
    await db.from("districts").select("*").eq("id", body.customer.districtId).limit(1),
  );
  if (districts.length !== 1) throw new AppError("invalid_input", 400);
  const district = districts[0];

  const salePrices = await flashPrices(db);
  const lines = [];
  for (const item of body.items) {
    const products = rows(
      await db.from("products").select(PRODUCT_COLUMNS).eq("id", item.productId).limit(1),
    );
    const product = products[0];
    if (!product || product.deleted_at != null || product.status !== "active") {
      throw new AppError("product_unavailable", 409);
    }

    const variants = rows(
      await db
        .from("product_variants")
        .select(VARIANT_COLUMNS)
        .eq("product_id", product.id)
        .limit(50),
    );
    let variant = null;
    if (item.variantId) {
      variant = variants.find((row) => row.id === item.variantId) ?? null;
      if (!variant) throw new AppError("variant_unavailable", 409);
    } else if (variants.length > 0) {
      throw new AppError("variant_required", 409);
    }

    const available = variant ? variant.stock : product.stock;
    if (available < item.qty) {
      return json(
        { error: "stock_unavailable", productId: product.id, available: Math.max(0, available) },
        409,
      );
    }

    const unitPricePaisa =
      salePrices.get(product.id) ?? (variant ? variant.price_paisa : product.price_paisa);
    lines.push({
      product,
      variant,
      qty: item.qty,
      unitPricePaisa,
      lineTotalPaisa: unitPricePaisa * item.qty,
    });
  }

  // Two variants of the same product share one product stock row, so their
  // quantities are checked together before anything is reserved.
  const perProductQty = new Map();
  for (const line of lines) {
    const total = (perProductQty.get(line.product.id) ?? 0) + line.qty;
    if (total > line.product.stock) {
      return json(
        { error: "stock_unavailable", productId: line.product.id, available: line.product.stock },
        409,
      );
    }
    perProductQty.set(line.product.id, total);
  }

  const subtotalPaisa = lines.reduce((total, line) => total + line.lineTotalPaisa, 0);
  let discountPaisa = 0;
  let freeShipping = false;
  let coupon = null;
  if (body.couponCode) {
    const evaluated = await evaluateCoupon(db, body.couponCode, subtotalPaisa, body.customer.phone);
    if (evaluated.error) return evaluated.error;
    coupon = evaluated.coupon;
    discountPaisa = evaluated.discountPaisa;
    freeShipping = evaluated.freeShipping;
  }

  const shippingPaisa = shippingFor(settings, district, subtotalPaisa, freeShipping);
  const totalPaisa = Math.max(0, subtotalPaisa - discountPaisa) + shippingPaisa;

  if (body.paymentMethod === "cod" && totalPaisa > settings.delivery.codLimitPaisa) {
    return json(
      { error: "cod_limit_exceeded", codLimitPaisa: settings.delivery.codLimitPaisa },
      409,
    );
  }

  const pending = [];
  const productStock = new Map();
  try {
    for (const line of lines) {
      if (!(await reserveLine(db, line, productStock, pending))) {
        await restoreStock(db, pending);
        return json(
          {
            error: "stock_unavailable",
            productId: line.product.id,
            available: productStock.get(line.product.id) ?? line.product.stock,
          },
          409,
        );
      }
    }
  } catch {
    await restoreStock(db, pending);
    throw new AppError("order_unconfirmed", 503);
  }

  const now = nowIso();
  const orderId = newId();
  const lookupToken = newId().replace(/-/g, "");
  const customer = body.customer;
  const orderRow = {
    id: orderId,
    order_number: "",
    lookup_token: lookupToken,
    idempotency_key: body.idempotencyKey ?? newId(),
    user_id: userId ?? null,
    status: "pending",
    payment_method: body.paymentMethod,
    payment_status: "unpaid",
    customer_name: customer.name,
    phone: customer.phone,
    email: customer.email ?? null,
    district_id: district.id,
    district_name_bn: district.name_bn,
    district_name_en: district.name_en,
    division_name_bn: district.division_bn,
    division_name_en: district.division_en,
    address: customer.address,
    area: customer.area ?? null,
    note: customer.note ?? null,
    subtotal_paisa: subtotalPaisa,
    discount_paisa: discountPaisa,
    shipping_paisa: shippingPaisa,
    total_paisa: totalPaisa,
    coupon_code: coupon ? coupon.code : null,
    marketing_consent: customer.marketingConsent === true,
    ip,
    user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    created_at: now,
    updated_at: now,
  };

  let inserted = [];
  for (let attempt = 0; attempt < 5 && inserted.length === 0; attempt += 1) {
    orderRow.order_number = randomOrderNumber();
    try {
      inserted = rows(
        await db
          .from("orders")
          .insertIfAbsent(orderRow, { onConflict: "order_number" })
          .select("id"),
      );
    } catch {
      await restoreStock(db, pending);
      throw new AppError("order_unconfirmed", 503);
    }
  }
  if (inserted.length !== 1) {
    await restoreStock(db, pending);
    throw new AppError("order_unconfirmed", 503);
  }

  try {
    for (const [position, line] of lines.entries()) {
      const itemRow = {
        id: newId(),
        order_id: orderId,
        position,
        product_id: line.product.id,
        product_slug: line.product.slug,
        variant_id: line.variant ? line.variant.id : null,
        sku: line.variant ? line.variant.sku : line.product.slug.toUpperCase().replace(/-/g, ""),
        name_bn: line.product.name_bn,
        name_en: line.product.name_en,
        variant_label_bn: line.variant ? line.variant.option_label_bn : null,
        variant_label_en: line.variant ? line.variant.option_label_en : null,
        unit_price_paisa: line.unitPricePaisa,
        qty: line.qty,
        line_total_paisa: line.lineTotalPaisa,
        image: line.product.image_small,
      };
      const saved = rows(
        await db.from("order_items").insertIfAbsent(itemRow, { onConflict: "id" }).select("id"),
      );
      if (saved.length !== 1) throw new AppError("order_unconfirmed", 503);
    }

    const historyRow = {
      id: newId(),
      order_id: orderId,
      status: "pending",
      note: "order_placed",
      actor_user_id: userId ?? null,
      created_at: now,
    };
    const historySaved = rows(
      await db
        .from("order_status_history")
        .insertIfAbsent(historyRow, { onConflict: "id" })
        .select("id"),
    );
    if (historySaved.length !== 1) throw new AppError("order_unconfirmed", 503);

    const paymentSaved = rows(
      await db
        .from("payments")
        .insertIfAbsent(
          {
            id: newId(),
            order_id: orderId,
            method: body.paymentMethod,
            status: "pending",
            amount_paisa: totalPaisa,
            provider_ref: null,
            created_at: now,
            updated_at: now,
          },
          { onConflict: "id" },
        )
        .select("id"),
    );
    if (paymentSaved.length !== 1) throw new AppError("order_unconfirmed", 503);

    if (coupon) {
      const redeemed = rows(
        await db
          .from("coupon_redemptions")
          .insertIfAbsent(
            {
              id: newId(),
              coupon_id: coupon.id,
              order_id: orderId,
              phone: customer.phone,
              created_at: now,
            },
            { onConflict: "coupon_id,order_id" },
          )
          .select("id"),
      );
      if (redeemed.length !== 1) throw new AppError("order_unconfirmed", 503);
    }
  } catch {
    try {
      await db
        .from("orders")
        .update({ status: "cancelled", updated_at: nowIso() })
        .eq("id", orderId)
        .select("id");
    } catch {
      /* order row stays pending for staff follow-up */
    }
    await restoreStock(db, pending);
    throw new AppError("order_unconfirmed", 503);
  }

  const detail = publicOrder(
    orderRow,
    lines.map((line, position) => ({
      order_id: orderId,
      position,
      product_id: line.product.id,
      product_slug: line.product.slug,
      variant_id: line.variant ? line.variant.id : null,
      sku: line.variant ? line.variant.sku : line.product.slug.toUpperCase().replace(/-/g, ""),
      name_bn: line.product.name_bn,
      name_en: line.product.name_en,
      variant_label_bn: line.variant ? line.variant.option_label_bn : null,
      variant_label_en: line.variant ? line.variant.option_label_en : null,
      unit_price_paisa: line.unitPricePaisa,
      qty: line.qty,
      line_total_paisa: line.lineTotalPaisa,
      image: line.product.image_small,
    })),
    [{ status: "pending", created_at: now }],
  );

  await sendOrderSms(db, {
    order: orderRow,
    template: "order.placed",
    origin: context.origin,
    env: context.env,
  });

  return json({ order: detail, lookupToken }, 201);
}

export async function handleOrderLookup(db, request, orderNumber, userId) {
  const limited = await limit(db, "order_lookup", clientIp(request));
  if (limited) return limited;

  const row = await findByNumber(db, orderNumber);
  const supplied = new URL(request.url).searchParams.get("token") ?? "";
  const tokenMatches = await secureCompare(supplied, row.lookup_token);
  const ownerMatches = typeof userId === "string" && row.user_id === userId;
  if (!tokenMatches && !ownerMatches) throw new AppError("order_not_found", 404);

  return json({ order: await loadOrderDetail(db, row) });
}

export async function handleTrackOrder(db, request) {
  const ipLimited = await limit(db, "track", clientIp(request));
  if (ipLimited) return ipLimited;

  const body = parse(trackOrderSchema, await readJson(request));
  const orderLimited = await limit(db, "track_order", body.orderNumber);
  if (orderLimited) return orderLimited;

  const row = await findByNumber(db, body.orderNumber);
  const phoneMatches = await secureCompare(body.phone, row.phone);
  if (!phoneMatches) throw new AppError("order_not_found", 404);

  return json({ order: await loadOrderDetail(db, row), lookupToken: row.lookup_token });
}

export async function handleAccountOrders(db, request, userId) {
  const rowsList = rows(
    await db.from("orders").select(ORDER_COLUMNS).eq("user_id", userId).limit(20),
  );
  const sorted = rowsList.sort((left, right) =>
    String(right.created_at).localeCompare(String(left.created_at)),
  );
  const details = [];
  for (const row of sorted) details.push(await loadOrderDetail(db, row));
  return json({ orders: details });
}
