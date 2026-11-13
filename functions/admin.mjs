// Admin operations: dashboard metrics, order fulfilment and product authoring.
// Authorization happens in app.mjs before any handler here runs; this module
// still receives the principal so every mutation can be attributed in the audit
// trail. Money is recomputed server-side and never taken from a client total.
import { AppError, json, readJson, rows } from "./http.mjs";
import {
  ITEM_COLUMNS,
  ORDER_COLUMNS,
  loadOrderDetail,
} from "./checkout.mjs";
import {
  adminAuditQuerySchema,
  adminImportRowSchema,
  adminOrderStatusSchema,
  adminOrdersQuerySchema,
  adminPaymentStatusSchema,
  adminProductsQuerySchema,
  ORDER_NUMBER_PATTERN,
  parse,
  productCreateSchema,
  productImportSchema,
  productUpdateSchema,
} from "./validate.mjs";
import { parseDetails, recordAudit } from "./audit.mjs";
import { courierOptions } from "./courier.mjs";
import { sendOrderSms } from "./sms.mjs";
import { awardLoyalty, notifyBackInStock, readMarketingSettings } from "./marketing.mjs";

const ADMIN_PRODUCT_COLUMNS =
  "id,slug,category_id,brand,name_bn,name_en,tagline_bn,tagline_en,description_bn,description_en,price_paisa,compare_at_paisa,stock,low_stock_threshold,rating_tenths,reviews,badge,image,image_small,status,featured,created_at,updated_at,deleted_at";
const VARIANT_COLUMNS =
  "id,product_id,sku,option_type,option_label_bn,option_label_en,price_paisa,stock,position,swatch";
const PLACEHOLDER_IMAGE = "/products/placeholder.svg";

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Fulfilment can only move forward, and a cancelled or returned order is final.
// Returning a delivered parcel restocks it; re-opening a closed order does not.
export const ORDER_TRANSITIONS = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["packed", "cancelled"],
  packed: ["shipped", "cancelled"],
  shipped: ["delivered", "returned"],
  delivered: ["returned"],
  returned: [],
  cancelled: [],
};

const RESTOCK_STATUSES = new Set(["cancelled", "returned"]);
const NON_REVENUE_STATUSES = new Set(["cancelled", "returned"]);
const OPEN_STATUSES = new Set(["pending", "confirmed", "packed"]);

const nowIso = () => new Date().toISOString();
const dhakaKey = (iso) =>
  new Date(Date.parse(iso) + DHAKA_OFFSET_MS).toISOString().slice(0, 10);

function statusCounts(orders) {
  const counts = Object.fromEntries(
    ["pending", "confirmed", "packed", "shipped", "delivered", "returned", "cancelled"].map(
      (status) => [status, 0],
    ),
  );
  for (const order of orders) {
    if (order.status in counts) counts[order.status] += 1;
  }
  return counts;
}

function orderSummary(row, itemCount) {
  return {
    orderNumber: row.order_number,
    status: row.status,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    customerName: row.customer_name,
    phone: row.phone,
    district: { bn: row.district_name_bn, en: row.district_name_en },
    totalPaisa: row.total_paisa,
    itemCount,
    couponCode: row.coupon_code ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function itemCounts(db) {
  const items = rows(await db.from("order_items").select("order_id,qty").limit(2000));
  const counts = new Map();
  for (const item of items) {
    counts.set(item.order_id, (counts.get(item.order_id) ?? 0) + 1);
  }
  return counts;
}

async function findOrderRow(db, orderNumber) {
  if (!ORDER_NUMBER_PATTERN.test(orderNumber)) throw new AppError("order_not_found", 404);
  const found = rows(
    await db.from("orders").select(ORDER_COLUMNS).eq("order_number", orderNumber).limit(1),
  );
  if (found.length !== 1) throw new AppError("order_not_found", 404);
  return found[0];
}

export async function handleAdminOrders(db, request) {
  const query = parse(adminOrdersQuerySchema, Object.fromEntries(new URL(request.url).searchParams));
  const all = rows(await db.from("orders").select(ORDER_COLUMNS).limit(500));
  const counts = await itemCounts(db);
  const needle = query.q ? query.q.toLowerCase() : "";

  const list = all
    .filter((row) => (query.status ? row.status === query.status : true))
    .filter((row) => {
      if (!needle) return true;
      return (
        row.order_number.toLowerCase().includes(needle) ||
        row.phone.toLowerCase().includes(needle) ||
        row.customer_name.toLowerCase().includes(needle)
      );
    })
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
    .map((row) => orderSummary(row, counts.get(row.id) ?? 0));

  return json({ orders: list, counts: statusCounts(all), total: list.length });
}

export async function handleAdminOrderDetail(db, orderNumber, env) {
  const row = await findOrderRow(db, orderNumber);
  return json({
    order: await loadOrderDetail(db, row),
    transitions: ORDER_TRANSITIONS[row.status] ?? [],
    couriers: courierOptions(env),
  });
}

// Compare-and-swap so a cancelled line cannot be double-restocked when two staff
// act at the same time; each attempt re-reads the current stock first.
async function adjustStock(db, table, id, delta) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const found = rows(await db.from(table).select("id,stock").eq("id", id).limit(1));
    if (found.length !== 1) return false;
    const current = found[0].stock;
    const updated = rows(
      await db
        .from(table)
        .update({ stock: Math.max(0, current + delta) })
        .eq("id", id)
        .eq("stock", current)
        .select("id"),
    );
    if (updated.length === 1) return true;
  }
  return false;
}

async function restockOrder(db, orderId) {
  const items = rows(
    await db.from("order_items").select(ITEM_COLUMNS).eq("order_id", orderId).limit(100),
  );
  let restored = 0;
  let failed = 0;
  for (const item of items) {
    if (await adjustStock(db, "products", item.product_id, item.qty)) restored += 1;
    else failed += 1;
    if (item.variant_id) {
      if (await adjustStock(db, "product_variants", item.variant_id, item.qty)) restored += 1;
      else failed += 1;
    }
  }
  return { restored, failed };
}

async function markCodPaid(db, orderId) {
  const now = nowIso();
  await db
    .from("orders")
    .update({ payment_status: "paid", updated_at: now })
    .eq("id", orderId)
    .select("id");
  try {
    await db
      .from("payments")
      .update({ status: "paid", updated_at: now })
      .eq("order_id", orderId)
      .select("id");
  } catch {
    /* the order-level payment status is authoritative for the customer */
  }
}

const STATUS_SMS = {
  confirmed: "order.confirmed",
  packed: "order.packed",
  shipped: "order.shipped",
  delivered: "order.delivered",
  cancelled: "order.cancelled",
  returned: "order.returned",
};

export async function handleAdminOrderStatus(db, request, principal, orderNumber, context) {
  const body = parse(adminOrderStatusSchema, await readJson(request));
  const row = await findOrderRow(db, orderNumber);
  const allowed = ORDER_TRANSITIONS[row.status] ?? [];
  if (!allowed.includes(body.status)) throw new AppError("invalid_transition", 409);

  const now = nowIso();
  const updated = rows(
    await db
      .from("orders")
      .update({ status: body.status, updated_at: now })
      .eq("id", row.id)
      .eq("status", row.status)
      .select(ORDER_COLUMNS),
  );
  if (updated.length !== 1) throw new AppError("update_unconfirmed", 503);

  const history = rows(
    await db
      .from("order_status_history")
      .insertIfAbsent(
        {
          id: crypto.randomUUID(),
          order_id: row.id,
          status: body.status,
          note: body.note ? body.note : "admin_update",
          actor_user_id: principal.user.id,
          created_at: now,
        },
        { onConflict: "id" },
      )
      .select("id"),
  );
  if (history.length !== 1) throw new AppError("status_history_unconfirmed", 503);

  let restock = null;
  if (RESTOCK_STATUSES.has(body.status)) restock = await restockOrder(db, row.id);

  // Delivered orders earn points once; the ledger's (order, reason) unique
  // constraint makes a repeated status call harmless.
  if (body.status === "delivered") {
    try {
      const marketing = await readMarketingSettings(db);
      const points =
        Math.floor(updated[0].total_paisa / 10000) * marketing.pointsPer100Taka;
      if (marketing.loyaltyEnabled && points > 0) {
        await awardLoyalty(db, {
          phone: updated[0].phone,
          userId: updated[0].user_id ?? null,
          points,
          reason: "order_delivered",
          orderNumber: updated[0].order_number,
        });
      }
    } catch {
      /* points are a bonus; delivery must not fail because of them */
    }
  }

  let paymentStatus = updated[0].payment_status;
  if (
    body.status === "delivered" &&
    row.payment_method === "cod" &&
    paymentStatus !== "paid"
  ) {
    await markCodPaid(db, row.id);
    paymentStatus = "paid";
  }

  await recordAudit(db, request, principal, {
    action: "order.status",
    entityType: "order",
    entityId: row.order_number,
    summary: `Order ${row.order_number}: ${row.status} → ${body.status}`,
    details: {
      from: row.status,
      to: body.status,
      note: body.note ?? null,
      paymentStatus,
      restocked: restock ? restock.restored : 0,
      restockFailed: restock ? restock.failed : 0,
    },
  });

  const fresh = rows(
    await db.from("orders").select(ORDER_COLUMNS).eq("id", row.id).limit(1),
  );
  const template = STATUS_SMS[body.status];
  if (template) {
    await sendOrderSms(db, {
      order: fresh[0],
      template,
      origin: context?.origin ?? "",
      env: context?.env,
    });
  }
  return json({
    ok: true,
    order: await loadOrderDetail(db, fresh[0]),
    restock,
  });
}

export async function handleAdminPaymentStatus(db, request, principal, orderNumber) {
  const body = parse(adminPaymentStatusSchema, await readJson(request));
  const row = await findOrderRow(db, orderNumber);
  const now = nowIso();
  const updated = rows(
    await db
      .from("orders")
      .update({ payment_status: body.paymentStatus, updated_at: now })
      .eq("id", row.id)
      .select(ORDER_COLUMNS),
  );
  if (updated.length !== 1) throw new AppError("update_unconfirmed", 503);

  try {
    await db
      .from("payments")
      .update({ status: body.paymentStatus, updated_at: now })
      .eq("order_id", row.id)
      .select("id");
  } catch {
    /* the order row already carries the status the customer sees */
  }

  await recordAudit(db, request, principal, {
    action: "order.payment",
    entityType: "order",
    entityId: row.order_number,
    summary: `Payment ${row.order_number}: ${row.payment_status} → ${body.paymentStatus}`,
    details: { from: row.payment_status, to: body.paymentStatus, note: body.note ?? null },
  });

  return json({ ok: true, order: await loadOrderDetail(db, updated[0]) });
}

export async function handleAdminDashboard(db) {
  const orders = rows(await db.from("orders").select(ORDER_COLUMNS).limit(500));
  const products = rows(
    await db.from("products").select(ADMIN_PRODUCT_COLUMNS).limit(300),
  ).filter((row) => row.deleted_at == null);
  const users = rows(await db.from("users").select("id,role_id,deleted_at").limit(500));
  const counts = await itemCounts(db);

  const todayKey = dhakaKey(nowIso());
  const today = orders.filter((row) => dhakaKey(row.created_at) === todayKey);
  const todayRevenue = today
    .filter((row) => !NON_REVENUE_STATUSES.has(row.status))
    .reduce((total, row) => total + row.total_paisa, 0);

  const trendKeys = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    trendKeys.push(dhakaKey(new Date(Date.now() - offset * DAY_MS).toISOString()));
  }
  const trend = trendKeys.map((date) => {
    const dayOrders = orders.filter((row) => dhakaKey(row.created_at) === date);
    return {
      date,
      orders: dayOrders.length,
      revenuePaisa: dayOrders
        .filter((row) => !NON_REVENUE_STATUSES.has(row.status))
        .reduce((total, row) => total + row.total_paisa, 0),
    };
  });

  const recent = [...orders]
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
    .slice(0, 6)
    .map((row) => orderSummary(row, counts.get(row.id) ?? 0));

  const lowStock = products
    .filter((row) => row.status === "active" && row.stock <= row.low_stock_threshold)
    .sort((left, right) => left.stock - right.stock)
    .slice(0, 6)
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      name: { bn: row.name_bn, en: row.name_en },
      image: row.image_small,
      stock: row.stock,
      threshold: row.low_stock_threshold,
    }));

  return json({
    metrics: {
      todayOrders: today.length,
      todayRevenuePaisa: todayRevenue,
      openOrders: orders.filter((row) => OPEN_STATUSES.has(row.status)).length,
      lowStockCount: products.filter(
        (row) => row.status === "active" && row.stock <= row.low_stock_threshold,
      ).length,
      activeProducts: products.filter((row) => row.status === "active").length,
      customers: users.filter(
        (row) => row.role_id === "customer" && row.deleted_at == null,
      ).length,
    },
    statusCounts: statusCounts(orders),
    trend,
    recentOrders: recent,
    lowStock,
  });
}

// ---------------------------------------------------------------------------
// Products

function adminVariant(row) {
  return {
    id: row.id,
    sku: row.sku,
    optionType: row.option_type,
    label: { bn: row.option_label_bn, en: row.option_label_en },
    pricePaisa: row.price_paisa,
    stock: row.stock,
    position: row.position,
    swatch: row.swatch ?? null,
  };
}

function adminProduct(row, variants = []) {
  return {
    id: row.id,
    slug: row.slug,
    categoryId: row.category_id,
    brand: row.brand ?? null,
    name: { bn: row.name_bn, en: row.name_en },
    tagline: { bn: row.tagline_bn, en: row.tagline_en },
    description: { bn: row.description_bn, en: row.description_en },
    pricePaisa: row.price_paisa,
    compareAtPaisa: row.compare_at_paisa ?? null,
    stock: row.stock,
    lowStockThreshold: row.low_stock_threshold,
    rating: (row.rating_tenths ?? 0) / 10,
    reviews: row.reviews ?? 0,
    badge: row.badge ?? null,
    image: row.image,
    imageSmall: row.image_small,
    featured: Boolean(row.featured),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
    variants: [...variants]
      .sort((left, right) => left.position - right.position)
      .map(adminVariant),
  };
}

async function variantsByProduct(db) {
  const variants = rows(await db.from("product_variants").select(VARIANT_COLUMNS).limit(1000));
  const grouped = new Map();
  for (const variant of variants) {
    const bucket = grouped.get(variant.product_id) ?? [];
    bucket.push(variant);
    grouped.set(variant.product_id, bucket);
  }
  return grouped;
}

export async function handleAdminProducts(db, request) {
  const query = parse(
    adminProductsQuerySchema,
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const products = rows(
    await db.from("products").select(ADMIN_PRODUCT_COLUMNS).limit(300),
  ).filter((row) => row.deleted_at == null);
  const grouped = await variantsByProduct(db);
  const needle = query.q ? query.q.toLowerCase() : "";

  const list = products
    .filter((row) => (query.status ? row.status === query.status : true))
    .filter((row) => {
      if (!needle) return true;
      return (
        row.name_en.toLowerCase().includes(needle) ||
        row.name_bn.includes(query.q) ||
        row.slug.includes(needle) ||
        (grouped.get(row.id) ?? []).some((variant) =>
          variant.sku.toLowerCase().includes(needle),
        )
      );
    })
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
    .map((row) => adminProduct(row, grouped.get(row.id) ?? []));

  return json({ products: list, total: list.length });
}

export async function handleAdminProductDetail(db, productId) {
  const found = rows(
    await db.from("products").select(ADMIN_PRODUCT_COLUMNS).eq("id", productId).limit(1),
  );
  if (found.length !== 1 || found[0].deleted_at != null) throw new AppError("not_found", 404);
  const variants = rows(
    await db.from("product_variants").select(VARIANT_COLUMNS).eq("product_id", productId).limit(50),
  );
  return json({ product: adminProduct(found[0], variants) });
}

async function categoryExists(db, categoryId) {
  const found = rows(
    await db.from("categories").select("id").eq("id", categoryId).limit(1),
  );
  return found.length === 1;
}

function slugify(value) {
  const slug = String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || `product-${crypto.randomUUID().slice(0, 8)}`;
}

async function slugTaken(db, slug, ignoreId = null) {
  const found = rows(await db.from("products").select("id").eq("slug", slug).limit(1));
  return found.length === 1 && found[0].id !== ignoreId;
}

async function takeSkus(db, ignoreProductId = null) {
  const variants = rows(await db.from("product_variants").select("product_id,sku").limit(2000));
  return new Set(
    variants
      .filter((variant) => variant.product_id !== ignoreProductId)
      .map((variant) => variant.sku),
  );
}

function nextSku(base, taken) {
  const stem = base.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "LP";
  let index = 1;
  let sku = `${stem}-${String(index).padStart(2, "0")}`;
  while (taken.has(sku)) {
    index += 1;
    sku = `${stem}-${String(index).padStart(2, "0")}`;
  }
  taken.add(sku);
  return sku;
}

function variantRow(input, productId, position, sku) {
  return {
    id: input.id ?? crypto.randomUUID(),
    product_id: productId,
    sku,
    option_type: input.optionType ?? "color",
    option_label_bn: input.labelBn,
    option_label_en: input.labelEn,
    price_paisa: input.pricePaisa,
    stock: input.stock,
    position,
    swatch: input.swatch ?? null,
  };
}

function productFields(body) {
  return {
    category_id: body.categoryId,
    brand: body.brand,
    name_bn: body.nameBn,
    name_en: body.nameEn,
    tagline_bn: body.taglineBn,
    tagline_en: body.taglineEn,
    description_bn: body.descriptionBn,
    description_en: body.descriptionEn,
    price_paisa: body.pricePaisa,
    compare_at_paisa: body.compareAtPaisa ?? null,
    low_stock_threshold: body.lowStockThreshold ?? 5,
    badge: body.badge ?? null,
    image: body.image,
    image_small: body.imageSmall ?? body.image,
    status: body.status,
    featured: body.featured,
  };
}

export async function handleProductCreate(db, request, principal) {
  const body = parse(productCreateSchema, await readJson(request, 128 * 1024));
  if (!(await categoryExists(db, body.categoryId))) throw new AppError("category_unknown", 409);

  const slug = body.slug ?? slugify(body.nameEn);
  if (await slugTaken(db, slug)) throw new AppError("slug_taken", 409);

  const taken = await takeSkus(db);
  const id = crypto.randomUUID();
  const now = nowIso();
  const skus = body.variants.map((input, index) => {
    if (input.sku) {
      const sku = input.sku.toUpperCase();
      if (taken.has(sku)) throw new AppError("sku_taken", 409);
      taken.add(sku);
      return sku;
    }
    return nextSku(`${slug}-${index + 1}`, taken);
  });

  const stock = body.variants.length
    ? body.variants.reduce((total, variant) => total + variant.stock, 0)
    : body.stock ?? 0;

  const row = {
    id,
    slug,
    ...productFields(body),
    stock,
    rating_tenths: 0,
    reviews: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };

  const created = rows(
    await db.from("products").insertIfAbsent(row, { onConflict: "id" }).select("id"),
  );
  if (created.length !== 1) throw new AppError("product_unconfirmed", 503);

  const variantRows = body.variants.map((input, index) =>
    variantRow(input, id, index, skus[index]),
  );
  for (const variant of variantRows) {
    const saved = rows(
      await db.from("product_variants").insertIfAbsent(variant, { onConflict: "id" }).select("id"),
    );
    if (saved.length !== 1) {
      // A partial catalog row is worse than a visible draft: the owner can open
      // it in the manager and finish the variants instead of hitting a 404 slug.
      try {
        await db
          .from("products")
          .update({ status: "draft", updated_at: nowIso() })
          .eq("id", id)
          .select("id");
      } catch {
        /* it stays active with fewer variants than requested */
      }
      throw new AppError("product_unconfirmed", 503);
    }
  }

  await recordAudit(db, request, principal, {
    action: "product.create",
    entityType: "product",
    entityId: id,
    summary: `Created product ${body.nameEn} (${slug})`,
    details: {
      slug,
      status: body.status,
      pricePaisa: body.pricePaisa,
      variants: variantRows.length,
      stock,
    },
  });

  return json({ product: adminProduct(row, variantRows) }, 201);
}

export async function handleProductUpdate(db, request, principal, productId, env) {
  const body = parse(productUpdateSchema, await readJson(request, 128 * 1024));
  const found = rows(
    await db.from("products").select(ADMIN_PRODUCT_COLUMNS).eq("id", productId).limit(1),
  );
  if (found.length !== 1 || found[0].deleted_at != null) throw new AppError("not_found", 404);
  const product = found[0];

  const slug = body.slug ?? product.slug;
  if (body.slug && (await slugTaken(db, body.slug, product.id))) {
    throw new AppError("slug_taken", 409);
  }
  const nextPrice = body.pricePaisa ?? product.price_paisa;
  const nextCompare =
    body.compareAtPaisa === undefined ? product.compare_at_paisa : body.compareAtPaisa;
  if (nextCompare != null && nextCompare < nextPrice) {
    throw new AppError("compare_at_below_price", 409);
  }

  const existingVariants = rows(
    await db.from("product_variants").select(VARIANT_COLUMNS).eq("product_id", product.id).limit(50),
  );
  const existingById = new Map(existingVariants.map((variant) => [variant.id, variant]));

  const patch = { slug, updated_at: nowIso() };
  if (body.categoryId !== undefined) {
    if (!(await categoryExists(db, body.categoryId))) throw new AppError("category_unknown", 409);
    patch.category_id = body.categoryId;
  }
  if (body.brand !== undefined) patch.brand = body.brand;
  if (body.nameBn !== undefined) patch.name_bn = body.nameBn;
  if (body.nameEn !== undefined) patch.name_en = body.nameEn;
  if (body.taglineBn !== undefined) patch.tagline_bn = body.taglineBn;
  if (body.taglineEn !== undefined) patch.tagline_en = body.taglineEn;
  if (body.descriptionBn !== undefined) patch.description_bn = body.descriptionBn;
  if (body.descriptionEn !== undefined) patch.description_en = body.descriptionEn;
  if (body.pricePaisa !== undefined) patch.price_paisa = body.pricePaisa;
  if (body.compareAtPaisa !== undefined) patch.compare_at_paisa = body.compareAtPaisa;
  if (body.lowStockThreshold !== undefined) patch.low_stock_threshold = body.lowStockThreshold;
  if (body.badge !== undefined) patch.badge = body.badge;
  if (body.image !== undefined) patch.image = body.image;
  if (body.imageSmall !== undefined) patch.image_small = body.imageSmall;
  if (body.status !== undefined) patch.status = body.status;
  if (body.featured !== undefined) patch.featured = body.featured;

  if (body.variants !== undefined && body.variants.length > 0) {
    // Own SKUs stay in the pool so an auto-generated SKU cannot clash with a
    // sibling variant; reusing a saved variant's own SKU is still allowed.
    const taken = await takeSkus(db);
    const newRows = [];
    const pendingUpdates = [];

    for (const [index, input] of body.variants.entries()) {
      const existing = input.id ? existingById.get(input.id) : undefined;
      if (input.id && !existing) throw new AppError("variant_not_found", 409);

      let sku;
      let autoGenerated = false;
      if (input.sku) {
        sku = input.sku.toUpperCase();
      } else if (existing) {
        sku = existing.sku;
      } else {
        sku = nextSku(`${slug}-${index + 1}`, taken);
        autoGenerated = true;
      }
      if (!autoGenerated && taken.has(sku) && existing?.sku !== sku) {
        throw new AppError("sku_taken", 409);
      }
      if (!autoGenerated) taken.add(sku);

      if (existing) {
        pendingUpdates.push({
          id: existing.id,
          values: {
            sku,
            option_type: input.optionType,
            option_label_bn: input.labelBn,
            option_label_en: input.labelEn,
            price_paisa: input.pricePaisa,
            stock: input.stock,
            position: input.position ?? index,
            swatch: input.swatch ?? null,
          },
        });
      } else {
        newRows.push(variantRow({ ...input, id: undefined }, product.id, input.position ?? index, sku));
      }
    }

    for (const update of pendingUpdates) {
      const saved = rows(
        await db
          .from("product_variants")
          .update(update.values)
          .eq("id", update.id)
          .select("id"),
      );
      if (saved.length !== 1) throw new AppError("update_unconfirmed", 503);
    }
    for (const row of newRows) {
      const saved = rows(
        await db.from("product_variants").insertIfAbsent(row, { onConflict: "id" }).select("id"),
      );
      if (saved.length !== 1) throw new AppError("product_unconfirmed", 503);
    }

    const updatedIds = new Set(pendingUpdates.map((update) => update.id));
    const untouched = existingVariants.filter((variant) => !updatedIds.has(variant.id));
    patch.stock = [
      ...untouched.map((variant) => variant.stock),
      ...pendingUpdates.map((update) => update.values.stock),
      ...newRows.map((row) => row.stock),
    ].reduce((total, value) => total + value, 0);
  } else if (body.stock !== undefined) {
    patch.stock = body.stock;
  }

  const updated = rows(
    await db.from("products").update(patch).eq("id", product.id).select(ADMIN_PRODUCT_COLUMNS),
  );
  if (updated.length !== 1) throw new AppError("update_unconfirmed", 503);

  const variants = rows(
    await db.from("product_variants").select(VARIANT_COLUMNS).eq("product_id", product.id).limit(50),
  );
  const changed = Object.keys(patch).filter((key) => key !== "updated_at");

  await recordAudit(db, request, principal, {
    action: "product.update",
    entityType: "product",
    entityId: product.id,
    summary: `Updated product ${updated[0].name_en} (${updated[0].slug})`,
    details: { changed, stock: updated[0].stock, variants: variants.length },
  });

  // Buyers who asked to be told when this product returned are messaged only
  // when stock actually crosses from zero back to positive.
  if (product.stock === 0 && updated[0].stock > 0 && updated[0].status === "active") {
    try {
      await notifyBackInStock(db, updated[0], env);
    } catch {
      /* an alert backlog must not block saving the product */
    }
  }

  return json({ product: adminProduct(updated[0], variants) });
}

export async function handleProductArchive(db, request, principal, productId) {
  const found = rows(
    await db.from("products").select(ADMIN_PRODUCT_COLUMNS).eq("id", productId).limit(1),
  );
  if (found.length !== 1 || found[0].deleted_at != null) throw new AppError("not_found", 404);

  const now = nowIso();
  const updated = rows(
    await db
      .from("products")
      .update({
        status: "archived",
        featured: false,
        deleted_at: now,
        updated_at: now,
      })
      .eq("id", productId)
      .select("id"),
  );
  if (updated.length !== 1) throw new AppError("update_unconfirmed", 503);

  await recordAudit(db, request, principal, {
    action: "product.archive",
    entityType: "product",
    entityId: productId,
    summary: `Archived product ${found[0].name_en} (${found[0].slug})`,
    details: { slug: found[0].slug, status: found[0].status },
  });

  return json({ ok: true });
}

export async function handleProductImport(db, request, principal) {
  const body = parse(productImportSchema, await readJson(request, 256 * 1024));
  const categoryRows = rows(await db.from("categories").select("id").limit(50));
  const categoryIds = new Set(categoryRows.map((row) => row.id));
  const existingSlugs = new Set(
    rows(await db.from("products").select("slug").limit(300)).map((row) => row.slug),
  );
  const takenSkus = await takeSkus(db);
  const status = body.publish ? "active" : "draft";

  const created = [];
  const skipped = [];

  for (const [index, raw] of body.rows.entries()) {
    const line = index + 2;
    const parsed = adminImportRowSchema.safeParse(raw);
    if (!parsed.success) {
      skipped.push({ line, reason: "invalid_row" });
      continue;
    }
    const row = parsed.data;
    if (!categoryIds.has(row.categoryId)) {
      skipped.push({ line, reason: "category_unknown" });
      continue;
    }

    const slug = slugify(row.nameEn);
    if (existingSlugs.has(slug)) {
      skipped.push({ line, reason: "slug_exists" });
      continue;
    }

    const hasVariant = Boolean(row.variantLabelEn && row.variantLabelBn);
    const sku = hasVariant
      ? (row.sku ? row.sku.toUpperCase() : nextSku(`${slug}-1`, takenSkus))
      : null;
    if (sku && takenSkus.has(sku)) {
      skipped.push({ line, reason: "sku_exists" });
      continue;
    }
    if (sku) takenSkus.add(sku);

    const variantStock = row.variantStock ?? row.stock;
    const now = nowIso();
    const id = crypto.randomUUID();
    const product = {
      id,
      slug,
      category_id: row.categoryId,
      brand: row.brand,
      name_bn: row.nameBn,
      name_en: row.nameEn,
      tagline_bn: row.taglineBn,
      tagline_en: row.taglineEn,
      description_bn: row.descriptionBn,
      description_en: row.descriptionEn,
      price_paisa: row.pricePaisa,
      compare_at_paisa: null,
      stock: hasVariant ? variantStock : row.stock,
      low_stock_threshold: 5,
      rating_tenths: 0,
      reviews: 0,
      badge: row.badge ?? null,
      image: row.image ?? PLACEHOLDER_IMAGE,
      image_small: row.image ?? PLACEHOLDER_IMAGE,
      status,
      featured: row.featured,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };

    existingSlugs.add(slug);
    try {
      const saved = rows(
        await db.from("products").insertIfAbsent(product, { onConflict: "id" }).select("id"),
      );
      if (saved.length !== 1) throw new Error("insert rejected");
      if (hasVariant && sku) {
        const variant = {
          id: crypto.randomUUID(),
          product_id: id,
          sku,
          option_type: row.optionType ?? "color",
          option_label_bn: row.variantLabelBn,
          option_label_en: row.variantLabelEn,
          price_paisa: row.variantPricePaisa ?? row.pricePaisa,
          stock: variantStock,
          position: 0,
          swatch: row.swatch ?? null,
        };
        const savedVariant = rows(
          await db
            .from("product_variants")
            .insertIfAbsent(variant, { onConflict: "id" })
            .select("id"),
        );
        if (savedVariant.length !== 1) throw new Error("variant rejected");
      }
    } catch {
      try {
        await db
          .from("products")
          .update({ status: "draft", updated_at: nowIso() })
          .eq("id", id)
          .select("id");
      } catch {
        /* nothing was written for this line */
      }
      skipped.push({ line, reason: "write_failed" });
      continue;
    }

    created.push({ id, slug, name: { bn: row.nameBn, en: row.nameEn }, status });
  }

  await recordAudit(db, request, principal, {
    action: "product.import",
    entityType: "product",
    entityId: null,
    summary: `Bulk import: ${created.length} created, ${skipped.length} skipped`,
    details: { created: created.length, skipped: skipped.length, status },
  });

  return json({ created: created.length, skipped, products: created });
}

function publicAuditEntry(row) {
  return {
    id: row.id,
    actor: {
      id: row.actor_user_id ?? null,
      name: row.actor_name,
      role: row.actor_role,
    },
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id ?? null,
    summary: row.summary,
    details: parseDetails(row.details),
    ip: row.ip ?? null,
    createdAt: row.created_at,
  };
}

function filterAudit(entries, query) {
  const from = query.from ? Date.parse(query.from) : null;
  const to = query.to ? Date.parse(query.to) : null;
  const needle = query.q ? query.q.toLowerCase() : null;
  return entries.filter((row) => {
    if (query.action && !String(row.action).startsWith(query.action)) return false;
    if (query.actorId && row.actor_user_id !== query.actorId) return false;
    const createdAt = Date.parse(row.created_at);
    if (from !== null && Number.isFinite(createdAt) && createdAt < from) return false;
    if (to !== null && Number.isFinite(createdAt) && createdAt > to) return false;
    if (needle) {
      const haystack = `${row.action} ${row.summary} ${row.entity_id ?? ""} ${row.actor_name}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

export async function handleAdminAudit(db, request) {
  const query = parse(adminAuditQuerySchema, Object.fromEntries(new URL(request.url).searchParams));
  const limit = query.limit ?? 50;
  const entries = rows(await db.from("audit_logs").select("*").limit(1000));
  const filtered = filterAudit(entries, query).sort((left, right) =>
    String(right.created_at).localeCompare(String(left.created_at)),
  );
  return json({
    entries: filtered.slice(0, limit).map(publicAuditEntry),
    total: filtered.length,
  });
}

// Owner-only portable copy of the audit trail, matching the on-screen filters.
export async function handleAdminAuditExport(db, request) {
  const query = parse(adminAuditQuerySchema, Object.fromEntries(new URL(request.url).searchParams));
  const entries = rows(await db.from("audit_logs").select("*").limit(5000));
  const filtered = filterAudit(entries, query).sort((left, right) =>
    String(right.created_at).localeCompare(String(left.created_at)),
  );
  const payload = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      total: filtered.length,
      entries: filtered.map(publicAuditEntry),
    },
    null,
    2,
  );
  return new Response(payload, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": 'attachment; filename="lootpat-audit.json"',
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

