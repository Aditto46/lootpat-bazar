// Admin marketing, review moderation and customer segments. Every mutation is
// audited. Segments and lifetime value are derived from orders, never stored as
// editable numbers, so the numbers always match the order table.
import { AppError, json, readJson, rows } from "./http.mjs";
import {
  adminBannerCreateSchema,
  adminBannerUpdateSchema,
  adminCampaignCreateSchema,
  adminCouponCreateSchema,
  adminCouponUpdateSchema,
  adminCustomerUpdateSchema,
  adminCustomersQuerySchema,
  adminFlashSaleCreateSchema,
  adminFlashSaleUpdateSchema,
  adminReviewQuerySchema,
  adminReviewUpdateSchema,
  adminSpinUpdateSchema,
  canonicalPhone,
  parse,
} from "./validate.mjs";
import { recordAudit } from "./audit.mjs";
import { revokeAllSessions } from "./sessions.mjs";
import { sendSmsMessage } from "./sms.mjs";
import { awardLoyalty, readMarketingSettings, refreshProductRating } from "./marketing.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const nowIso = () => new Date().toISOString();

function couponStatus(row, now = Date.now()) {
  if (!row.active) return "inactive";
  if (row.ends_at && Date.parse(row.ends_at) < now) return "expired";
  if (row.starts_at && Date.parse(row.starts_at) > now) return "scheduled";
  return "active";
}

function publicCoupon(row, redemptions) {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    value: row.value,
    minSubtotalPaisa: row.min_subtotal_paisa,
    maxDiscountPaisa: row.max_discount_paisa ?? null,
    usageLimit: row.usage_limit ?? null,
    perCustomerLimit: row.per_customer_limit ?? null,
    startsAt: row.starts_at ?? null,
    endsAt: row.ends_at ?? null,
    active: Boolean(row.active),
    status: couponStatus(row),
    redemptions,
    createdAt: row.created_at,
  };
}

export async function handleAdminCoupons(db) {
  const coupons = rows(await db.from("coupons").select("*").limit(300));
  const redemptions = rows(
    await db.from("coupon_redemptions").select("coupon_id").limit(5000),
  );
  const counts = new Map();
  for (const redemption of redemptions) {
    counts.set(redemption.coupon_id, (counts.get(redemption.coupon_id) ?? 0) + 1);
  }
  return json({
    coupons: coupons
      .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
      .map((row) => publicCoupon(row, counts.get(row.id) ?? 0)),
  });
}

function validateCouponShape(kind, value) {
  if (kind === "percent" && (value < 1 || value > 90)) {
    throw new AppError("invalid_percent", 409);
  }
  if (kind === "fixed" && value < 100) throw new AppError("invalid_fixed_value", 409);
  if (kind === "free_shipping" && value !== 0) {
    throw new AppError("invalid_free_shipping_value", 409);
  }
}

export async function handleAdminCouponCreate(db, request, principal) {
  const body = parse(adminCouponCreateSchema, await readJson(request));
  const code = body.code.toUpperCase();
  validateCouponShape(body.kind, body.value);

  const existing = rows(await db.from("coupons").select("id").eq("code", code).limit(1));
  if (existing.length > 0) throw new AppError("code_taken", 409);

  const row = {
    id: crypto.randomUUID(),
    code,
    kind: body.kind,
    value: body.value,
    min_subtotal_paisa: body.minSubtotalPaisa,
    max_discount_paisa: body.maxDiscountPaisa ?? null,
    usage_limit: body.usageLimit ?? null,
    per_customer_limit: body.perCustomerLimit ?? null,
    starts_at: body.startsAt ?? null,
    ends_at: body.endsAt ?? null,
    active: body.active,
    created_at: nowIso(),
  };
  const saved = rows(
    await db.from("coupons").insertIfAbsent(row, { onConflict: "id" }).select("id"),
  );
  if (saved.length !== 1) throw new AppError("coupon_unconfirmed", 503);

  await recordAudit(db, request, principal, {
    action: "marketing.coupon.create",
    entityType: "coupon",
    entityId: row.id,
    summary: `Coupon ${code} created (${body.kind} ${body.value})`,
    details: { kind: body.kind, value: body.value, active: body.active },
  });

  return json({ coupon: publicCoupon(row, 0) }, 201);
}

export async function handleAdminCouponUpdate(db, request, principal, couponId) {
  const body = parse(adminCouponUpdateSchema, await readJson(request));
  const found = rows(await db.from("coupons").select("*").eq("id", couponId).limit(1));
  if (found.length !== 1) throw new AppError("not_found", 404);
  const coupon = found[0];

  const kind = body.kind ?? coupon.kind;
  const value = body.value ?? coupon.value;
  validateCouponShape(kind, value);

  const startsAt = body.startsAt === undefined ? coupon.starts_at : body.startsAt;
  const endsAt = body.endsAt === undefined ? coupon.ends_at : body.endsAt;
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new AppError("invalid_window", 409);
  }

  const patch = { kind, value };
  if (body.minSubtotalPaisa !== undefined) patch.min_subtotal_paisa = body.minSubtotalPaisa;
  if (body.maxDiscountPaisa !== undefined) patch.max_discount_paisa = body.maxDiscountPaisa;
  if (body.usageLimit !== undefined) patch.usage_limit = body.usageLimit;
  if (body.perCustomerLimit !== undefined) patch.per_customer_limit = body.perCustomerLimit;
  if (body.startsAt !== undefined) patch.starts_at = body.startsAt;
  if (body.endsAt !== undefined) patch.ends_at = body.endsAt;
  if (body.active !== undefined) patch.active = body.active;

  const updated = rows(
    await db.from("coupons").update(patch).eq("id", coupon.id).select("*"),
  );
  if (updated.length !== 1) throw new AppError("update_unconfirmed", 503);

  await recordAudit(db, request, principal, {
    action: "marketing.coupon.update",
    entityType: "coupon",
    entityId: coupon.id,
    summary: `Coupon ${coupon.code} updated`,
    details: { changed: Object.keys(patch), active: updated[0].active },
  });

  return json({ coupon: publicCoupon(updated[0], 0) });
}

// ---------------------------------------------------------------------------
// Flash sales.

function saleItemView(item, product) {
  return {
    id: item.id,
    productId: product.id,
    name: { bn: product.name_bn, en: product.name_en },
    image: product.image_small,
    pricePaisa: product.price_paisa,
    salePricePaisa: item.sale_price_paisa,
    stock: product.stock,
    stockLimit: item.stock_limit ?? null,
    soldCount: item.sold_count ?? 0,
  };
}

async function saleView(db, sale) {
  const items = rows(
    await db.from("flash_sale_items").select("*").eq("sale_id", sale.id).limit(20),
  );
  const products = rows(await db.from("products").select("*").limit(300));
  const byId = new Map(products.map((product) => [product.id, product]));
  const list = items.flatMap((item) => {
    const product = byId.get(item.product_id);
    return product ? [saleItemView(item, product)] : [];
  });
  return {
    id: sale.id,
    title: { bn: sale.title_bn, en: sale.title_en },
    subtitle: { bn: sale.subtitle_bn, en: sale.subtitle_en },
    discountPercent: sale.discount_percent,
    bannerImage: sale.banner_image ?? null,
    status: sale.status,
    startsAt: sale.starts_at,
    endsAt: sale.ends_at,
    items: list,
    createdAt: sale.created_at,
  };
}

async function writeSaleItems(db, saleId, productIds, discountPercent) {
  const products = rows(await db.from("products").select("*").limit(300));
  const byId = new Map(products.map((product) => [product.id, product]));
  const existing = rows(
    await db.from("flash_sale_items").select("*").eq("sale_id", saleId).limit(20),
  );
  const existingByProduct = new Map(existing.map((item) => [item.product_id, item]));

  for (const productId of productIds) {
    const product = byId.get(productId);
    if (!product || product.deleted_at != null) throw new AppError("product_not_found", 409);
    const salePrice = Math.max(
      100,
      Math.round((product.price_paisa * (100 - discountPercent)) / 100 / 100) * 100,
    );
    const current = existingByProduct.get(productId);
    if (current) {
      rows(
        await db
          .from("flash_sale_items")
          .update({ sale_price_paisa: salePrice })
          .eq("id", current.id)
          .select("id"),
      );
      continue;
    }
    rows(
      await db
        .from("flash_sale_items")
        .insertIfAbsent(
          {
            id: crypto.randomUUID(),
            sale_id: saleId,
            product_id: productId,
            sale_price_paisa: salePrice,
            stock_limit: Math.max(1, Math.min(product.stock, 10)),
            sold_count: 0,
            created_at: nowIso(),
          },
          { onConflict: "sale_id,product_id" },
        )
        .select("id"),
    );
  }
}

export async function handleAdminFlashSales(db) {
  const sales = rows(await db.from("flash_sales").select("*").limit(50)).sort((left, right) =>
    String(right.created_at).localeCompare(String(left.created_at)),
  );
  const list = [];
  for (const sale of sales) list.push(await saleView(db, sale));
  return json({ sales: list });
}

export async function handleAdminFlashSaleCreate(db, request, principal) {
  const body = parse(adminFlashSaleCreateSchema, await readJson(request));
  const now = nowIso();
  const row = {
    id: crypto.randomUUID(),
    title_bn: body.titleBn,
    title_en: body.titleEn,
    subtitle_bn: body.subtitleBn,
    subtitle_en: body.subtitleEn,
    discount_percent: body.discountPercent,
    banner_image: body.bannerImage ?? null,
    status: body.status,
    starts_at: body.startsAt,
    ends_at: body.endsAt,
    created_at: now,
    updated_at: now,
  };
  const saved = rows(
    await db.from("flash_sales").insertIfAbsent(row, { onConflict: "id" }).select("id"),
  );
  if (saved.length !== 1) throw new AppError("sale_unconfirmed", 503);

  await writeSaleItems(db, row.id, body.productIds, body.discountPercent);

  await recordAudit(db, request, principal, {
    action: "marketing.flashSale.create",
    entityType: "flash_sale",
    entityId: row.id,
    summary: `Flash sale ${body.titleEn} created (${body.discountPercent}%)`,
    details: { status: body.status, products: body.productIds.length },
  });

  return json({ sale: await saleView(db, row) }, 201);
}

export async function handleAdminFlashSaleUpdate(db, request, principal, saleId) {
  const body = parse(adminFlashSaleUpdateSchema, await readJson(request));
  const found = rows(await db.from("flash_sales").select("*").eq("id", saleId).limit(1));
  if (found.length !== 1) throw new AppError("not_found", 404);
  const sale = found[0];

  const startsAt = body.startsAt ?? sale.starts_at;
  const endsAt = body.endsAt ?? sale.ends_at;
  if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new AppError("invalid_window", 409);

  const patch = { starts_at: startsAt, ends_at: endsAt, updated_at: nowIso() };
  if (body.titleBn !== undefined) patch.title_bn = body.titleBn;
  if (body.titleEn !== undefined) patch.title_en = body.titleEn;
  if (body.subtitleBn !== undefined) patch.subtitle_bn = body.subtitleBn;
  if (body.subtitleEn !== undefined) patch.subtitle_en = body.subtitleEn;
  if (body.discountPercent !== undefined) patch.discount_percent = body.discountPercent;
  if (body.bannerImage !== undefined) patch.banner_image = body.bannerImage;
  if (body.status !== undefined) patch.status = body.status;

  const updated = rows(
    await db.from("flash_sales").update(patch).eq("id", sale.id).select("*"),
  );
  if (updated.length !== 1) throw new AppError("update_unconfirmed", 503);

  const discount = body.discountPercent ?? sale.discount_percent;
  if (body.productIds !== undefined || body.discountPercent !== undefined) {
    const current = rows(
      await db.from("flash_sale_items").select("product_id").eq("sale_id", sale.id).limit(20),
    );
    const productIds = body.productIds ?? current.map((item) => item.product_id);
    await writeSaleItems(db, sale.id, productIds, discount);
  }

  await recordAudit(db, request, principal, {
    action: "marketing.flashSale.update",
    entityType: "flash_sale",
    entityId: sale.id,
    summary: `Flash sale ${updated[0].title_en} updated`,
    details: { changed: Object.keys(patch), products: body.productIds?.length ?? null },
  });

  return json({ sale: await saleView(db, updated[0]) });
}

// ---------------------------------------------------------------------------
// Spin configuration.

export async function handleAdminSpin(db) {
  const settings = await readMarketingSettings(db);
  const prizes = rows(await db.from("spin_prizes").select("*").limit(20)).sort(
    (left, right) => left.position - right.position,
  );
  const spins = rows(await db.from("spin_results").select("*").limit(5000));
  return json({
    enabled: settings.spinEnabled,
    totalSpins: spins.length,
    prizes: prizes.map((prize) => ({
      id: prize.id,
      label: { bn: prize.label_bn, en: prize.label_en },
      kind: prize.kind,
      value: prize.value,
      weight: prize.weight,
      active: Boolean(prize.active),
      position: prize.position,
    })),
  });
}

export async function handleAdminSpinUpdate(db, request, principal) {
  const body = parse(adminSpinUpdateSchema, await readJson(request));
  const now = nowIso();

  if (body.prizes) {
    const existing = rows(await db.from("spin_prizes").select("*").limit(20));
    const existingById = new Map(existing.map((prize) => [prize.id, prize]));

    for (const [index, prize] of body.prizes.entries()) {
      if (prize.id && existingById.has(prize.id)) {
        rows(
          await db
            .from("spin_prizes")
            .update({
              label_bn: prize.labelBn,
              label_en: prize.labelEn,
              kind: prize.kind,
              value: prize.value,
              weight: prize.weight,
              active: prize.active,
              position: index,
            })
            .eq("id", prize.id)
            .select("id"),
        );
      } else {
        const id = prize.id ?? `spin-${crypto.randomUUID().slice(0, 8)}`;
        rows(
          await db
            .from("spin_prizes")
            .insertIfAbsent(
              {
                id,
                label_bn: prize.labelBn,
                label_en: prize.labelEn,
                kind: prize.kind,
                value: prize.value,
                weight: prize.weight,
                active: prize.active,
                position: index,
                created_at: now,
              },
              { onConflict: "id" },
            )
            .select("id"),
        );
      }
    }
  }

  if (body.enabled !== undefined) {
    const updated = rows(
      await db
        .from("settings")
        .update({ value: String(body.enabled) })
        .eq("key", "marketing.spin_enabled")
        .select("key"),
    );
    if (updated.length === 0) {
      await db
        .from("settings")
        .insertIfAbsent(
          { key: "marketing.spin_enabled", value: String(body.enabled) },
          { onConflict: "key" },
        )
        .select("key");
    }
  }

  await recordAudit(db, request, principal, {
    action: "marketing.spin.update",
    entityType: "settings",
    entityId: "spin",
    summary: "Spin wheel configuration updated",
    details: { enabled: body.enabled ?? null, prizes: body.prizes?.length ?? null },
  });

  return handleAdminSpin(db);
}

// ---------------------------------------------------------------------------
// Campaigns. SMS goes through the same provider and log as order messages;
// email is recorded only because no mail provider is configured in this build.

function consentingPhones(orders) {
  const map = new Map();
  for (const order of orders) {
    if (!order.marketing_consent) continue;
    if (!order.phone) continue;
    const current = map.get(order.phone);
    map.set(order.phone, {
      phone: order.phone,
      name: order.customer_name,
      email: order.email ?? null,
      lifetimePaisa: (current?.lifetimePaisa ?? 0) +
        (["cancelled", "returned"].includes(order.status) ? 0 : order.total_paisa),
      lastOrderAt: !current || String(order.created_at) > current.lastOrderAt
        ? order.created_at
        : current.lastOrderAt,
      orders: (current?.orders ?? 0) + 1,
    });
  }
  return map;
}

function audienceList(orders, settings, audience) {
  const customers = [...consentingPhones(orders).values()];
  const inactiveBefore = Date.now() - settings.inactiveDays * DAY_MS;
  if (audience === "vip") {
    return customers.filter((customer) => customer.lifetimePaisa >= settings.vipLifetimePaisa);
  }
  if (audience === "inactive") {
    return customers.filter((customer) => Date.parse(customer.lastOrderAt) < inactiveBefore);
  }
  return customers;
}

async function suppressedContacts(db) {
  const suppressions = rows(
    await db.from("marketing_suppressions").select("contact").limit(5000),
  );
  const users = rows(
    await db.from("users").select("email,phone,marketing_opt_out").limit(500),
  );
  const set = new Set(suppressions.map((row) => row.contact));
  for (const user of users) {
    if (!user.marketing_opt_out) continue;
    if (user.email) set.add(user.email);
    if (user.phone) set.add(user.phone);
  }
  return set;
}

function campaignView(row) {
  return {
    id: row.id,
    channel: row.channel,
    subject: row.subject,
    body: row.body,
    audience: row.audience,
    status: row.status,
    recipients: row.recipients,
    createdAt: row.created_at,
    sentAt: row.sent_at ?? null,
  };
}

export async function handleAdminCampaigns(db) {
  const settings = await readMarketingSettings(db);
  const orders = rows(await db.from("orders").select("*").limit(2000));
  const campaigns = rows(await db.from("campaigns").select("*").limit(100)).sort(
    (left, right) => String(right.created_at).localeCompare(String(left.created_at)),
  );
  const reminders = rows(await db.from("cart_reminders").select("*").limit(100)).sort(
    (left, right) => String(right.created_at).localeCompare(String(left.created_at)),
  );

  return json({
    campaigns: campaigns.map(campaignView),
    audienceCounts: {
      all: audienceList(orders, settings, "all").length,
      vip: audienceList(orders, settings, "vip").length,
      inactive: audienceList(orders, settings, "inactive").length,
    },
    reminders: reminders.slice(0, 30).map((row) => ({
      id: row.id,
      phone: row.phone,
      itemCount: row.item_count,
      createdAt: row.created_at,
    })),
    emailConfigured: false,
  });
}

export async function handleAdminCampaignCreate(db, request, principal, env) {
  const body = parse(adminCampaignCreateSchema, await readJson(request));
  const settings = await readMarketingSettings(db);
  const orders = rows(await db.from("orders").select("*").limit(2000));
  const audience = audienceList(orders, settings, body.audience);
  const suppressed = await suppressedContacts(db);
  const recipients = audience.filter(
    (customer) =>
      !suppressed.has(customer.phone) &&
      (!customer.email || !suppressed.has(customer.email)),
  );

  const id = crypto.randomUUID();
  const now = nowIso();
  let smsSent = 0;
  let emailSkipped = 0;
  if (body.send) {
    for (const customer of recipients.slice(0, 25)) {
      if (body.channel === "sms") {
        await sendSmsMessage(db, {
          phone: customer.phone,
          message: body.body,
          template: "campaign.sms",
          env,
        });
        smsSent += 1;
      } else {
        emailSkipped += 1;
      }
    }
  }

  const row = {
    id,
    channel: body.channel,
    subject: body.subject,
    body: body.body,
    audience: body.audience,
    status: body.send ? "sent" : "draft",
    recipients: body.send ? recipients.length : 0,
    created_by: principal.user.id,
    created_at: now,
    sent_at: body.send ? now : null,
  };
  const saved = rows(
    await db.from("campaigns").insertIfAbsent(row, { onConflict: "id" }).select("id"),
  );
  if (saved.length !== 1) throw new AppError("campaign_unconfirmed", 503);

  await recordAudit(db, request, principal, {
    action: body.send ? "marketing.campaign.send" : "marketing.campaign.create",
    entityType: "campaign",
    entityId: id,
    summary: `${body.channel} campaign ${body.send ? "sent" : "drafted"} to ${body.audience}`,
    details: {
      audience: body.audience,
      recipients: recipients.length,
      smsSent,
      emailSkipped,
    },
  });

  return json(
    {
      campaign: campaignView(row),
      delivery: { smsSent, emailSkipped, suppressed: audience.length - recipients.length },
    },
    body.send ? 200 : 201,
  );
}

// ---------------------------------------------------------------------------
// Reviews.

function reviewProductName(product) {
  return product ? { bn: product.name_bn, en: product.name_en } : { bn: "", en: "" };
}

export async function handleAdminReviews(db, request) {
  const query = parse(adminReviewQuerySchema, Object.fromEntries(new URL(request.url).searchParams));
  const all = rows(await db.from("reviews").select("*").limit(500)).sort((left, right) =>
    String(right.created_at).localeCompare(String(left.created_at)),
  );
  const products = rows(await db.from("products").select("id,name_bn,name_en").limit(300));
  const byId = new Map(products.map((product) => [product.id, product]));

  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const review of all) {
    if (review.status in counts) counts[review.status] += 1;
  }

  const list = all
    .filter((review) => (query.status ? review.status === query.status : true))
    .slice(0, 100)
    .map((review) => {
      let photos = [];
      try {
        const parsed = JSON.parse(review.photo_urls ?? "[]");
        photos = Array.isArray(parsed)
          ? parsed.filter((entry) => typeof entry === "string").slice(0, 2)
          : [];
      } catch {
        photos = [];
      }
      return {
        id: review.id,
        productId: review.product_id,
        productName: reviewProductName(byId.get(review.product_id)),
        orderNumber: review.order_number,
        customerName: review.customer_name,
        phone: review.phone,
        rating: review.rating,
        title: review.title ?? null,
        body: review.body,
        photos,
        verifiedPurchase: Boolean(review.verified_purchase),
        status: review.status,
        helpfulCount: review.helpful_count ?? 0,
        reply: review.reply_body ?? null,
        repliedAt: review.replied_at ?? null,
        createdAt: review.created_at,
      };
    });

  return json({ reviews: list, counts });
}

export async function handleAdminReviewUpdate(db, request, principal, reviewId) {
  const body = parse(adminReviewUpdateSchema, await readJson(request));
  const found = rows(await db.from("reviews").select("*").eq("id", reviewId).limit(1));
  if (found.length !== 1) throw new AppError("not_found", 404);
  const review = found[0];

  const patch = { updated_at: nowIso() };
  if (body.status !== undefined) patch.status = body.status;
  if (body.reply !== undefined) {
    patch.reply_body = body.reply;
    patch.replied_at = nowIso();
    patch.replied_by = principal.user.id;
  }
  const updated = rows(
    await db.from("reviews").update(patch).eq("id", review.id).select("*"),
  );
  if (updated.length !== 1) throw new AppError("update_unconfirmed", 503);

  if (body.status !== undefined) {
    await refreshProductRating(db, review.product_id);
  }

  if (body.status === "approved") {
    try {
      const settings = await readMarketingSettings(db);
      const users = rows(
        await db.from("users").select("id,phone").eq("phone", review.phone).limit(1),
      );
      await awardLoyalty(db, {
        phone: review.phone,
        userId: users[0]?.id ?? review.user_id ?? null,
        points: settings.reviewPoints,
        reason: "review_reward",
        orderNumber: `review:${review.id}`,
      });
    } catch {
      /* a failed points write must not undo the approval */
    }
  }

  await recordAudit(db, request, principal, {
    action: "review.update",
    entityType: "review",
    entityId: review.id,
    summary: `Review ${review.id.slice(0, 8)} ${body.status ?? "replied"}`,
    details: { status: body.status ?? null, replied: body.reply !== undefined },
  });

  return json({
    review: {
      id: updated[0].id,
      status: updated[0].status,
      reply: updated[0].reply_body ?? null,
      repliedAt: updated[0].replied_at ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Customers and segments.

async function customerDirectory(db) {
  const orders = rows(await db.from("orders").select("*").limit(2000));
  const notes = rows(await db.from("customer_notes").select("*").limit(5000));
  const blocks = rows(await db.from("customer_blocks").select("*").limit(2000));
  const users = rows(
    await db.from("users").select("id,name,email,phone,role_id,status,created_at").limit(500),
  );
  const ledger = rows(await db.from("loyalty_ledger").select("*").limit(5000));
  const settings = await readMarketingSettings(db);

  const map = new Map();
  const ensure = (phone) => {
    if (!map.has(phone)) {
      map.set(phone, {
        phone,
        name: "",
        email: null,
        orders: 0,
        deliveredOrders: 0,
        lifetimePaisa: 0,
        firstOrderAt: null,
        lastOrderAt: null,
        createdAt: null,
      });
    }
    return map.get(phone);
  };

  for (const order of orders) {
    const customer = ensure(order.phone);
    customer.orders += 1;
    if (order.status === "delivered") customer.deliveredOrders += 1;
    if (!["cancelled", "returned"].includes(order.status)) {
      customer.lifetimePaisa += order.total_paisa;
    }
    if (!customer.firstOrderAt || String(order.created_at) < customer.firstOrderAt) {
      customer.firstOrderAt = order.created_at;
    }
    if (!customer.lastOrderAt || String(order.created_at) > customer.lastOrderAt) {
      customer.lastOrderAt = order.created_at;
      customer.name = order.customer_name;
      customer.email = order.email ?? customer.email;
    }
  }

  for (const user of users) {
    if (user.role_id !== "customer" || !user.phone || user.status !== "active") continue;
    const customer = ensure(user.phone);
    if (!customer.name) customer.name = user.name;
    if (!customer.email) customer.email = user.email ?? null;
    customer.createdAt = user.created_at;
  }

  const noteCount = new Map();
  for (const note of notes) noteCount.set(note.phone, (noteCount.get(note.phone) ?? 0) + 1);
  const activeBlocks = new Map(
    blocks.filter((block) => block.active).map((block) => [block.phone, block]),
  );
  const points = new Map();
  for (const entry of ledger) points.set(entry.phone, (points.get(entry.phone) ?? 0) + entry.points);

  const inactiveBefore = Date.now() - settings.inactiveDays * DAY_MS;
  return [...map.values()].map((customer) => {
    const blocked = activeBlocks.get(customer.phone) ?? null;
    let segment = "regular";
    if (customer.lifetimePaisa >= settings.vipLifetimePaisa || customer.deliveredOrders >= 3) {
      segment = "vip";
    } else if (customer.orders > 0 && customer.lastOrderAt &&
      Date.parse(customer.lastOrderAt) < inactiveBefore) {
      segment = "inactive";
    } else if (customer.orders <= 1) {
      segment = "new";
    }
    return {
      ...customer,
      segment,
      noteCount: noteCount.get(customer.phone) ?? 0,
      points: points.get(customer.phone) ?? 0,
      blocked: Boolean(blocked),
      blockReason: blocked?.reason ?? null,
    };
  });
}

export async function handleAdminCustomers(db, request) {
  const query = parse(adminCustomersQuerySchema, Object.fromEntries(new URL(request.url).searchParams));
  let customers = await customerDirectory(db);
  const counts = {
    all: customers.length,
    vip: customers.filter((customer) => customer.segment === "vip").length,
    inactive: customers.filter((customer) => customer.segment === "inactive").length,
    new: customers.filter((customer) => customer.segment === "new").length,
  };
  if (query.segment && query.segment !== "all") {
    customers = customers.filter((customer) => customer.segment === query.segment);
  }
  if (query.q) {
    const needle = query.q.toLowerCase();
    customers = customers.filter(
      (customer) =>
        customer.phone.includes(needle) ||
        customer.name.toLowerCase().includes(needle) ||
        String(customer.email ?? "").toLowerCase().includes(needle),
    );
  }
  customers.sort((left, right) =>
    String(right.lastOrderAt ?? "").localeCompare(String(left.lastOrderAt ?? "")),
  );
  return json({ customers: customers.slice(0, 200), counts });
}

export async function handleAdminCustomerDetail(db, phone) {
  let canonical;
  try {
    canonical = canonicalPhone(phone);
  } catch {
    throw new AppError("not_found", 404);
  }
  const customers = await customerDirectory(db);
  const customer = customers.find((entry) => entry.phone === canonical);
  if (!customer) throw new AppError("not_found", 404);

  const orders = rows(
    await db.from("orders").select("order_number,status,payment_status,total_paisa,created_at").eq("phone", canonical).limit(200),
  ).sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
  const notes = rows(
    await db.from("customer_notes").select("*").eq("phone", canonical).limit(100),
  ).sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));

  return json({
    customer: {
      ...customer,
      orders: orders.map((order) => ({
        orderNumber: order.order_number,
        status: order.status,
        paymentStatus: order.payment_status,
        totalPaisa: order.total_paisa,
        createdAt: order.created_at,
      })),
      notes: notes.map((note) => ({
        id: note.id,
        body: note.body,
        createdAt: note.created_at,
      })),
    },
  });
}

export async function handleAdminCustomerUpdate(db, request, principal, phone) {
  let canonical;
  try {
    canonical = canonicalPhone(phone);
  } catch {
    throw new AppError("not_found", 404);
  }
  const body = parse(adminCustomerUpdateSchema, await readJson(request));

  if (body.action === "note") {
    const row = {
      id: crypto.randomUUID(),
      phone: canonical,
      body: body.note,
      created_by: principal.user.id,
      created_at: nowIso(),
    };
    const saved = rows(
      await db.from("customer_notes").insertIfAbsent(row, { onConflict: "id" }).select("id"),
    );
    if (saved.length !== 1) throw new AppError("note_unconfirmed", 503);
    await recordAudit(db, request, principal, {
      action: "customer.note",
      entityType: "customer",
      entityId: canonical,
      summary: `Note added for ${canonical}`,
      details: { length: body.note.length },
    });
    return json({ note: { id: row.id, body: row.body, createdAt: row.created_at } }, 201);
  }

  const active = body.action === "block";
  const patch = {
    active,
    reason: active ? body.reason ?? "" : "",
    blocked_by: principal.user.id,
    updated_at: nowIso(),
  };
  const existing = rows(
    await db.from("customer_blocks").select("phone").eq("phone", canonical).limit(1),
  );
  const saved = existing.length > 0
    ? rows(await db.from("customer_blocks").update(patch).eq("phone", canonical).select("phone"))
    : rows(
        await db
          .from("customer_blocks")
          .insertIfAbsent(
            { phone: canonical, created_at: nowIso(), ...patch },
            { onConflict: "phone" },
          )
          .select("phone"),
      );
  if (saved.length !== 1) throw new AppError("update_unconfirmed", 503);

  // A blocked buyer who has an account also loses their active sessions.
  try {
    const users = rows(
      await db
        .from("users")
        .select("id,role_id")
        .eq("phone", canonical)
        .limit(1),
    );
    if (users.length === 1 && users[0].role_id === "customer") {
      await db
        .from("users")
        .update({ status: active ? "suspended" : "active", updated_at: nowIso() })
        .eq("id", users[0].id)
        .select("id");
      if (active) await revokeAllSessions(db, users[0].id);
    }
  } catch {
    /* the blocklist already stops new orders from this phone */
  }

  await recordAudit(db, request, principal, {
    action: active ? "customer.block" : "customer.unblock",
    entityType: "customer",
    entityId: canonical,
    summary: `${active ? "Blocked" : "Unblocked"} customer ${canonical}`,
    details: { reason: patch.reason || null },
  });

  return json({ ok: true, blocked: active });
}

// ---------------------------------------------------------------------------
// Banners.

export async function handleAdminBanners(db) {
  const banners = rows(await db.from("banners").select("*").limit(50)).sort(
    (left, right) => left.position - right.position,
  );
  return json({
    banners: banners.map((banner) => ({
      id: banner.id,
      title: { bn: banner.title_bn, en: banner.title_en },
      body: { bn: banner.body_bn, en: banner.body_en },
      cta: { bn: banner.cta_label_bn, en: banner.cta_label_en },
      href: banner.href,
      tone: banner.tone,
      active: Boolean(banner.active),
      position: banner.position,
      startsAt: banner.starts_at ?? null,
      endsAt: banner.ends_at ?? null,
    })),
  });
}

export async function handleAdminBannerCreate(db, request, principal) {
  const body = parse(adminBannerCreateSchema, await readJson(request));
  const row = {
    id: crypto.randomUUID(),
    title_bn: body.titleBn,
    title_en: body.titleEn,
    body_bn: body.bodyBn,
    body_en: body.bodyEn,
    cta_label_bn: body.ctaLabelBn,
    cta_label_en: body.ctaLabelEn,
    href: body.href,
    tone: body.tone,
    active: body.active,
    position: body.position,
    starts_at: body.startsAt ?? null,
    ends_at: body.endsAt ?? null,
    created_at: nowIso(),
  };
  const saved = rows(
    await db.from("banners").insertIfAbsent(row, { onConflict: "id" }).select("id"),
  );
  if (saved.length !== 1) throw new AppError("banner_unconfirmed", 503);

  await recordAudit(db, request, principal, {
    action: "marketing.banner.create",
    entityType: "banner",
    entityId: row.id,
    summary: `Banner ${body.titleEn} created`,
    details: { href: body.href, active: body.active },
  });

  return json({ ok: true, id: row.id }, 201);
}

export async function handleAdminBannerUpdate(db, request, principal, bannerId) {
  const body = parse(adminBannerUpdateSchema, await readJson(request));
  const found = rows(await db.from("banners").select("id").eq("id", bannerId).limit(1));
  if (found.length !== 1) throw new AppError("not_found", 404);

  const updated = rows(
    await db.from("banners").update({ active: body.active }).eq("id", bannerId).select("id"),
  );
  if (updated.length !== 1) throw new AppError("update_unconfirmed", 503);

  await recordAudit(db, request, principal, {
    action: "marketing.banner.update",
    entityType: "banner",
    entityId: bannerId,
    summary: `Banner ${bannerId.slice(0, 8)} ${body.active ? "enabled" : "disabled"}`,
    details: { active: body.active },
  });

  return json({ ok: true, active: body.active });
}
