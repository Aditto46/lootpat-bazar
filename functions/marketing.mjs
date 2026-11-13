// Storefront marketing: moderated photo reviews, flash sales, the spin wheel,
// loyalty points, back-in-stock alerts, banners, cart reminders and unsubscribe.
// Every reward that becomes money (spin prize, redeemed points) is minted as a
// normal coupon row, so checkout applies the same server-side rules as any other
// discount and the client never supplies a price.
import { AppError, clientIp, json, readJson, rows, secureCompare } from "./http.mjs";
import { consume } from "./limiter.mjs";
import { sendSmsMessage } from "./sms.mjs";
import {
  accountProfileSchema,
  backInStockSchema,
  canonicalEmail,
  canonicalPhone,
  cartReminderSchema,
  loyaltyRedeemSchema,
  parse,
  reviewCreateSchema,
  reviewHelpfulSchema,
  spinPlaySchema,
  unsubscribeSchema,
} from "./validate.mjs";

const PHOTO_MAX_BYTES = 300 * 1024;
const REVIEW_PHOTO_PREFIX = /^data:image\/(jpeg|png|webp);base64,/;
const DAY_MS = 24 * 60 * 60 * 1000;
const ORDER_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

const nowIso = () => new Date().toISOString();
const newId = () => crypto.randomUUID();

function randomCode(prefix, length = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  const suffix = Array.from(bytes, (byte) => ORDER_ALPHABET[byte % ORDER_ALPHABET.length]).join("");
  return `${prefix}-${suffix}`;
}

function rateLimited(result) {
  const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  return json({ error: "rate_limited" }, 429, { "retry-after": String(seconds) });
}

async function limit(db, scope, subject) {
  const result = await consume(db, scope, subject);
  return result.allowed ? null : rateLimited(result);
}

export async function readMarketingSettings(db) {
  const stored = rows(await db.from("settings").select("key,value").limit(300));
  const values = new Map(stored.map((row) => [row.key, row.value]));
  const integer = (key, fallback) => {
    const parsed = Number(values.get(key));
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
  };
  return {
    loyaltyEnabled: values.get("loyalty.enabled") === "true",
    pointsPer100Taka: integer("loyalty.points_per_100_taka", 1),
    pointValuePaisa: integer("loyalty.point_value_paisa", 50),
    reviewPoints: integer("loyalty.review_points", 20),
    redeemMinPoints: integer("loyalty.redeem_min_points", 100),
    birthdayCoupon: values.get("loyalty.birthday_coupon") ?? "",
    spinEnabled: values.get("marketing.spin_enabled") === "true",
    vipLifetimePaisa: integer("marketing.vip_lifetime_paisa", 1_000_000),
    inactiveDays: integer("marketing.inactive_days", 60),
  };
}

// ---------------------------------------------------------------------------
// Photo handling. Base64 is decoded once, the declared type must match the
// actual magic bytes, EXIF metadata is stripped from JPEGs (and rejected from
// PNG/WebP, which cannot be sanitized safely here), and every photo is capped.

function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function sniffImage(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

function containsAscii(bytes, text) {
  const needle = Array.from(text, (character) => character.charCodeAt(0));
  outer: for (let index = 0; index <= bytes.length - needle.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (bytes[index + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}

function stripJpegExif(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const chunks = [bytes.subarray(0, 2)];
  let cursor = 2;
  while (cursor + 3 < bytes.length) {
    if (bytes[cursor] !== 0xff) return bytes;
    const marker = bytes[cursor + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      chunks.push(bytes.subarray(cursor, cursor + 2));
      cursor += 2;
      continue;
    }
    if (marker === 0xda) {
      chunks.push(bytes.subarray(cursor));
      break;
    }
    const length = (bytes[cursor + 2] << 8) | bytes[cursor + 3];
    if (length < 2 || cursor + 2 + length > bytes.length) return bytes;
    const segment = bytes.subarray(cursor, cursor + 2 + length);
    const isExif =
      marker === 0xe1 &&
      length >= 8 &&
      containsAscii(segment.subarray(4, 8), "Exif");
    if (!isExif) chunks.push(segment);
    cursor += 2 + length;
  }
  if (chunks.length === 1) return bytes;
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function sanitizePhotos(dataUrls) {
  const stored = [];
  for (const dataUrl of dataUrls) {
    const declared = REVIEW_PHOTO_PREFIX.exec(dataUrl)?.[1];
    if (!declared) throw new AppError("photo_invalid", 400);
    let bytes;
    try {
      bytes = base64ToBytes(dataUrl.slice(dataUrl.indexOf(",") + 1));
    } catch {
      throw new AppError("photo_invalid", 400);
    }
    if (bytes.length === 0 || bytes.length > PHOTO_MAX_BYTES) {
      throw new AppError("photo_too_large", 400);
    }
    const actual = sniffImage(bytes);
    if (!actual || (declared === "jpeg" && actual !== "jpeg") ||
      (declared === "png" && actual !== "png") ||
      (declared === "webp" && actual !== "webp")) {
      throw new AppError("photo_invalid", 400);
    }
    if (actual === "jpeg") {
      const clean = stripJpegExif(bytes);
      stored.push(`data:image/jpeg;base64,${bytesToBase64(clean)}`);
    } else {
      if (containsAscii(bytes, actual === "png" ? "eXIf" : "EXIF")) {
        throw new AppError("photo_exif_rejected", 400);
      }
      stored.push(`data:image/${actual};base64,${bytesToBase64(bytes)}`);
    }
  }
  return stored;
}

function parsePhotos(value) {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => typeof entry === "string" && entry.startsWith("data:image/")).slice(0, 2);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Reviews.

function publicReview(row) {
  return {
    id: row.id,
    rating: row.rating,
    title: row.title ?? null,
    body: row.body,
    photos: parsePhotos(row.photo_urls),
    customerName: row.customer_name,
    verifiedPurchase: Boolean(row.verified_purchase),
    helpfulCount: row.helpful_count ?? 0,
    reply: row.reply_body ? { body: row.reply_body, at: row.replied_at ?? null } : null,
    createdAt: row.created_at,
  };
}

// Catalog rating follows verified reviews only; seeded marketing counters stay
// untouched until a real buyer has something to say.
export async function refreshProductRating(db, productId) {
  const reviews = rows(
    await db
      .from("reviews")
      .select("rating,status,verified_purchase,product_id")
      .eq("product_id", productId)
      .limit(1000),
  ).filter((row) => row.status === "approved" && row.verified_purchase);
  if (reviews.length === 0) return;
  const average = reviews.reduce((total, row) => total + row.rating, 0) / reviews.length;
  rows(
    await db
      .from("products")
      .update({
        rating_tenths: Math.round(average * 10),
        reviews: reviews.length,
        updated_at: nowIso(),
      })
      .eq("id", productId)
      .select("id"),
  );
}

async function findActiveProductBySlug(db, slug) {
  const found = rows(
    await db
      .from("products")
      .select("id,slug,name_bn,name_en,price_paisa,compare_at_paisa,stock,image,image_small")
      .eq("slug", slug)
      .eq("status", "active")
      .limit(1),
  );
  return found.length === 1 && found[0].deleted_at == null ? found[0] : null;
}

export async function handleProductReviews(db, slug) {
  const product = await findActiveProductBySlug(db, slug);
  if (!product) throw new AppError("not_found", 404);

  const approved = rows(
    await db
      .from("reviews")
      .select(
        "id,rating,title,body,photo_urls,customer_name,verified_purchase,helpful_count,reply_body,replied_at,created_at,status",
      )
      .eq("product_id", product.id)
      .limit(200),
  )
    .filter((row) => row.status === "approved")
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));

  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const review of approved) {
    if (review.rating >= 1 && review.rating <= 5) breakdown[review.rating] += 1;
  }
  const total = approved.length;
  const averageTenths = total
    ? Math.round((approved.reduce((sum, row) => sum + row.rating, 0) / total) * 10)
    : 0;

  return json({
    productId: product.id,
    summary: { count: total, averageTenths, breakdown },
    reviews: approved.slice(0, 50).map(publicReview),
  });
}

export async function handleReviewCreate(db, request, userId) {
  const ipLimit = await limit(db, "review_create", clientIp(request));
  if (ipLimit) return ipLimit;

  // Two 400k-char photo data URLs need more than the default JSON body cap.
  const body = parse(reviewCreateSchema, await readJson(request, 1024 * 1024));
  const orderLimited = await limit(db, "review_create", body.orderNumber);
  if (orderLimited) return orderLimited;

  const orders = rows(
    await db.from("orders").select("id,order_number,phone,user_id,status,customer_name").eq("order_number", body.orderNumber).limit(1),
  );
  if (orders.length !== 1) throw new AppError("order_not_found", 404);
  const order = orders[0];
  if (!(await secureCompare(body.phone, order.phone))) throw new AppError("order_not_found", 404);
  if (order.status !== "delivered") return json({ error: "order_not_delivered" }, 409);

  const items = rows(
    await db.from("order_items").select("product_id").eq("order_id", order.id).limit(50),
  );
  if (!items.some((row) => row.product_id === body.productId)) {
    return json({ error: "product_not_in_order" }, 409);
  }

  const existing = rows(
    await db
      .from("reviews")
      .select("id")
      .eq("order_id", order.id)
      .eq("product_id", body.productId)
      .limit(1),
  );
  if (existing.length > 0) return json({ error: "review_exists" }, 409);

  const photos = sanitizePhotos(body.photos);
  const now = nowIso();
  const row = {
    id: newId(),
    product_id: body.productId,
    order_id: order.id,
    order_number: order.order_number,
    user_id: userId ?? order.user_id ?? null,
    customer_name: String(order.customer_name || "Customer").slice(0, 80),
    phone: order.phone,
    rating: body.rating,
    title: body.title ?? null,
    body: body.body,
    photo_urls: JSON.stringify(photos),
    verified_purchase: true,
    status: "pending",
    helpful_count: 0,
    reply_body: null,
    replied_at: null,
    replied_by: null,
    created_at: now,
    updated_at: now,
  };
  const inserted = rows(
    await db.from("reviews").insertIfAbsent(row, { onConflict: "id" }).select("id"),
  );
  if (inserted.length !== 1) throw new AppError("review_unconfirmed", 503);
  return json({ review: { id: row.id, status: "pending" } }, 201);
}

export async function handleReviewHelpful(db, request, reviewId) {
  const ipLimit = await limit(db, "review_helpful", clientIp(request));
  if (ipLimit) return ipLimit;

  const body = parse(reviewHelpfulSchema, await readJson(request));
  const found = rows(
    await db
      .from("reviews")
      .select("id,status,helpful_count")
      .eq("id", reviewId)
      .limit(1),
  );
  if (found.length !== 1 || found[0].status !== "approved") {
    throw new AppError("not_found", 404);
  }

  const vote = rows(
    await db
      .from("review_votes")
      .insertIfAbsent(
        { review_id: reviewId, voter_key: body.voterKey, created_at: nowIso() },
        { onConflict: "review_id,voter_key" },
      )
      .select("review_id"),
  );
  if (vote.length === 0) {
    return json({ ok: true, helpfulCount: found[0].helpful_count ?? 0 });
  }

  const count = (found[0].helpful_count ?? 0) + 1;
  rows(
    await db
      .from("reviews")
      .update({ helpful_count: count, updated_at: nowIso() })
      .eq("id", reviewId)
      .eq("helpful_count", found[0].helpful_count ?? 0)
      .select("id"),
  );
  return json({ ok: true, helpfulCount: count });
}

// ---------------------------------------------------------------------------
// Flash sales and banners.

function publicSaleItem(item, product) {
  return {
    productId: product.id,
    slug: product.slug,
    name: { bn: product.name_bn, en: product.name_en },
    image: product.image,
    imageSmall: product.image_small,
    pricePaisa: product.price_paisa,
    compareAtPaisa: product.compare_at_paisa ?? null,
    salePricePaisa: item.sale_price_paisa,
    stock: product.stock,
    stockLimit: item.stock_limit ?? null,
    soldCount: item.sold_count ?? 0,
  };
}

export async function handleFlashSale(db) {
  const now = Date.now();
  const sales = rows(await db.from("flash_sales").select("*").limit(20))
    .filter((sale) => sale.status === "active")
    .filter((sale) => Date.parse(sale.starts_at) <= now && Date.parse(sale.ends_at) > now)
    .sort((left, right) => Date.parse(right.starts_at) - Date.parse(left.starts_at));
  const sale = sales[0];
  if (!sale) return json({ sale: null });

  const items = rows(
    await db.from("flash_sale_items").select("*").eq("sale_id", sale.id).limit(20),
  );
  const products = rows(await db.from("products").select("*").limit(300)).filter(
    (product) => product.deleted_at == null && product.status === "active",
  );
  const byId = new Map(products.map((product) => [product.id, product]));

  return json({
    sale: {
      id: sale.id,
      title: { bn: sale.title_bn, en: sale.title_en },
      subtitle: { bn: sale.subtitle_bn, en: sale.subtitle_en },
      discountPercent: sale.discount_percent,
      bannerImage: sale.banner_image ?? null,
      startsAt: sale.starts_at,
      endsAt: sale.ends_at,
      items: items.flatMap((item) => {
        const product = byId.get(item.product_id);
        return product ? [publicSaleItem(item, product)] : [];
      }),
    },
  });
}

export async function handleBanners(db) {
  const now = Date.now();
  const banners = rows(await db.from("banners").select("*").limit(20))
    .filter((banner) => banner.active)
    .filter((banner) => !banner.starts_at || Date.parse(banner.starts_at) <= now)
    .filter((banner) => !banner.ends_at || Date.parse(banner.ends_at) > now)
    .sort((left, right) => left.sort_order - right.sort_order);
  return json({
    banners: banners.map((banner) => ({
      id: banner.id,
      title: { bn: banner.title_bn, en: banner.title_en },
      body: { bn: banner.body_bn, en: banner.body_en },
      cta: { bn: banner.cta_label_bn, en: banner.cta_label_en },
      href: banner.href,
      tone: banner.tone,
    })),
  });
}

// ---------------------------------------------------------------------------
// Spin wheel.

async function mintCoupon(db, { code, kind, value, minSubtotalPaisa = 0, endsAt, usageLimit = 1 }) {
  const now = nowIso();
  const row = {
    id: newId(),
    code,
    kind,
    value,
    min_subtotal_paisa: minSubtotalPaisa,
    max_discount_paisa: null,
    usage_limit: usageLimit,
    per_customer_limit: 1,
    starts_at: now,
    ends_at: endsAt,
    active: true,
    created_at: now,
  };
  const saved = rows(
    await db.from("coupons").insertIfAbsent(row, { onConflict: "code" }).select("code"),
  );
  return saved.length === 1 ? row : null;
}

export async function handleSpinPublic(db) {
  const settings = await readMarketingSettings(db);
  const prizes = rows(await db.from("spin_prizes").select("*").limit(20))
    .filter((prize) => prize.active)
    .sort((left, right) => left.sort_order - right.sort_order);
  return json({
    enabled: settings.spinEnabled && prizes.length > 0,
    prizes: prizes.map((prize) => ({
      id: prize.id,
      label: { bn: prize.label_bn, en: prize.label_en },
      kind: prize.kind,
      value: prize.value,
    })),
  });
}

export async function handleSpinPlay(db, request) {
  const ipLimit = await limit(db, "spin", clientIp(request));
  if (ipLimit) return ipLimit;

  const body = parse(spinPlaySchema, await readJson(request));
  const visitorLimit = await limit(db, "spin_visitor", body.visitorKey);
  if (visitorLimit) return visitorLimit;

  const settings = await readMarketingSettings(db);
  if (!settings.spinEnabled) return json({ error: "spin_disabled" }, 409);

  const replay = rows(
    await db.from("spin_results").select("*").eq("visitor_key", body.visitorKey).limit(1),
  );
  if (replay.length === 1) {
    const prizes = rows(
      await db.from("spin_prizes").select("*").eq("id", replay[0].prize_id).limit(1),
    );
    return json({
      alreadyPlayed: true,
      prize: prizes.length
        ? {
            id: prizes[0].id,
            label: { bn: prizes[0].label_bn, en: prizes[0].label_en },
          }
        : { id: replay[0].prize_id, label: { bn: "", en: "" } },
      couponCode: replay[0].coupon_code,
    });
  }

  const prizes = rows(await db.from("spin_prizes").select("*").limit(20)).filter(
    (prize) => prize.active,
  );
  if (prizes.length === 0) return json({ error: "spin_disabled" }, 409);

  const totalWeight = prizes.reduce((total, prize) => total + prize.weight, 0);
  const draw = crypto.getRandomValues(new Uint32Array(1))[0] % totalWeight;
  let cursor = 0;
  let prize = prizes[0];
  for (const candidate of prizes) {
    cursor += candidate.weight;
    if (draw < cursor) {
      prize = candidate;
      break;
    }
  }

  // Claim the visitor first so a double submit cannot mint two coupons.
  const resultId = newId();
  const claimed = rows(
    await db
      .from("spin_results")
      .insertIfAbsent(
        {
          id: resultId,
          visitor_key: body.visitorKey,
          prize_id: prize.id,
          coupon_code: "",
          created_at: nowIso(),
        },
        { onConflict: "visitor_key" },
      )
      .select("id"),
  );
  if (claimed.length !== 1) {
    const existing = rows(
      await db.from("spin_results").select("*").eq("visitor_key", body.visitorKey).limit(1),
    );
    return json({
      alreadyPlayed: true,
      prize: { id: prize.id, label: { bn: prize.label_bn, en: prize.label_en } },
      couponCode: existing[0]?.coupon_code ?? "",
    });
  }

  const endsAt = new Date(Date.now() + 7 * DAY_MS).toISOString();
  let coupon = null;
  for (let attempt = 0; attempt < 4 && !coupon; attempt += 1) {
    coupon = await mintCoupon(db, {
      code: randomCode("SPIN"),
      kind: prize.kind,
      value: prize.value,
      endsAt,
    });
  }
  if (!coupon) throw new AppError("reward_unconfirmed", 503);

  rows(
    await db
      .from("spin_results")
      .update({ coupon_code: coupon.code })
      .eq("id", resultId)
      .select("id"),
  );

  return json({
    alreadyPlayed: false,
    prize: { id: prize.id, label: { bn: prize.label_bn, en: prize.label_en } },
    couponCode: coupon.code,
    coupon: { kind: coupon.kind, value: coupon.value, expiresAt: endsAt },
  });
}

// ---------------------------------------------------------------------------
// Loyalty.

export async function awardLoyalty(db, { phone, userId = null, points, reason, orderNumber }) {
  if (!phone || !Number.isSafeInteger(points) || points === 0) return false;
  const saved = rows(
    await db
      .from("loyalty_ledger")
      .insertIfAbsent(
        {
          id: newId(),
          user_id: userId ?? null,
          phone,
          points,
          reason,
          order_number: orderNumber,
          created_at: nowIso(),
        },
        { onConflict: "order_number,reason" },
      )
      .select("id"),
  );
  return saved.length === 1;
}

function ledgerFor(entries, user) {
  return entries.filter(
    (entry) =>
      (user.phone && entry.phone === user.phone) ||
      (entry.user_id != null && entry.user_id === user.id),
  );
}

function publicLedgerEntry(entry) {
  return {
    id: entry.id,
    points: entry.points,
    reason: entry.reason,
    orderNumber: entry.order_number ?? null,
    createdAt: entry.created_at,
  };
}

function birthdayGift(settings, couponRows, birthDate) {
  if (!settings.birthdayCoupon || !birthDate) return null;
  const birth = new Date(`${birthDate}T00:00:00.000Z`);
  if (Number.isNaN(birth.getTime())) return null;
  if (birth.getUTCMonth() !== new Date().getUTCMonth()) return null;
  const coupon = couponRows.find((row) => row.code === settings.birthdayCoupon && row.active);
  if (!coupon) return null;
  return {
    code: coupon.code,
    kind: coupon.kind,
    value: coupon.value,
    minSubtotalPaisa: coupon.min_subtotal_paisa,
    maxDiscountPaisa: coupon.max_discount_paisa ?? null,
    endsAt: coupon.ends_at ?? null,
  };
}

export async function handleLoyalty(db, request, userId) {
  const users = rows(
    await db.from("users").select("id,name,phone,email,birth_date").eq("id", userId).limit(1),
  );
  if (users.length !== 1) throw new AppError("not_found", 404);
  const user = users[0];

  const settings = await readMarketingSettings(db);
  const entries = ledgerFor(
    rows(await db.from("loyalty_ledger").select("*").limit(5000)),
    user,
  ).sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
  const balance = entries.reduce((total, entry) => total + entry.points, 0);
  const coupons = settings.birthdayCoupon
    ? rows(
        await db.from("coupons").select("*").eq("code", settings.birthdayCoupon).limit(1),
      )
    : [];

  return json({
    enabled: settings.loyaltyEnabled,
    balance,
    valuePaisa: Math.max(0, balance) * settings.pointValuePaisa,
    earn: {
      pointsPer100Taka: settings.pointsPer100Taka,
      reviewPoints: settings.reviewPoints,
      redeemMinPoints: settings.redeemMinPoints,
      pointValuePaisa: settings.pointValuePaisa,
    },
    birthday: birthdayGift(settings, coupons, user.birth_date ?? null),
    ledger: entries.slice(0, 12).map(publicLedgerEntry),
  });
}

export async function handleLoyaltyRedeem(db, request, userId) {
  const ipLimit = await limit(db, "loyalty_redeem", clientIp(request));
  if (ipLimit) return ipLimit;

  const body = parse(loyaltyRedeemSchema, await readJson(request));
  const users = rows(
    await db.from("users").select("id,phone").eq("id", userId).limit(1),
  );
  if (users.length !== 1) throw new AppError("not_found", 404);
  const user = users[0];
  if (!user.phone) return json({ error: "phone_required" }, 409);

  const settings = await readMarketingSettings(db);
  if (!settings.loyaltyEnabled) return json({ error: "loyalty_disabled" }, 409);

  const entries = ledgerFor(
    rows(await db.from("loyalty_ledger").select("*").limit(5000)),
    user,
  );
  const balance = entries.reduce((total, entry) => total + entry.points, 0);
  const minimum = Math.max(100, settings.redeemMinPoints);
  if (body.points % 100 !== 0 || body.points < minimum) {
    return json({ error: "invalid_points", minPoints: minimum }, 409);
  }
  if (body.points > balance) return json({ error: "insufficient_points", balance }, 409);

  const valuePaisa = body.points * settings.pointValuePaisa;
  if (valuePaisa <= 0) return json({ error: "invalid_points" }, 409);

  const endsAt = new Date(Date.now() + 60 * DAY_MS).toISOString();
  let coupon = null;
  for (let attempt = 0; attempt < 4 && !coupon; attempt += 1) {
    coupon = await mintCoupon(db, {
      code: randomCode("LOYAL"),
      kind: "fixed",
      value: valuePaisa,
      endsAt,
    });
  }
  if (!coupon) throw new AppError("reward_unconfirmed", 503);

  await awardLoyalty(db, {
    phone: user.phone,
    userId: user.id,
    points: -body.points,
    reason: "loyalty_redeem",
    orderNumber: `redeem:${coupon.code}`,
  });

  return json({
    coupon: { code: coupon.code, kind: "fixed", value: valuePaisa, minSubtotalPaisa: 0, expiresAt: endsAt },
    balance: balance - body.points,
  });
}

// ---------------------------------------------------------------------------
// Alerts, consent and profile.

export async function handleBackInStockRequest(db, request) {
  const ipLimit = await limit(db, "back_in_stock", clientIp(request));
  if (ipLimit) return ipLimit;

  const body = parse(backInStockSchema, await readJson(request));
  const phoneLimit = await limit(db, "back_in_stock", body.phone);
  if (phoneLimit) return phoneLimit;

  const products = rows(
    await db.from("products").select("id,stock,status,deleted_at").eq("id", body.productId).limit(1),
  );
  if (products.length !== 1 || products[0].deleted_at != null || products[0].status !== "active") {
    throw new AppError("not_found", 404);
  }
  if (products[0].stock > 0) return json({ ok: true, available: true });

  const existing = rows(
    await db
      .from("back_in_stock_alerts")
      .select("id")
      .eq("product_id", body.productId)
      .eq("phone", body.phone)
      .limit(1),
  );
  if (existing.length === 0) {
    rows(
      await db
        .from("back_in_stock_alerts")
        .insertIfAbsent(
          {
            id: newId(),
            product_id: body.productId,
            phone: body.phone,
            notified_at: null,
            created_at: nowIso(),
          },
          { onConflict: "id" },
        )
        .select("id"),
    );
  }
  return json({ ok: true, available: false });
}

export async function notifyBackInStock(db, product, env) {
  const alerts = rows(
    await db
      .from("back_in_stock_alerts")
      .select("id,phone,notified_at")
      .eq("product_id", product.id)
      .limit(200),
  ).filter((alert) => alert.notified_at == null);
  if (alerts.length === 0) return 0;

  const message = `লুটপাট বাজার: ${product.name_bn} আবার স্টকে এসেছে। সীমিত স্টক — এখনই অর্ডার করুন।`;
  let notified = 0;
  for (const alert of alerts.slice(0, 50)) {
    await sendSmsMessage(db, {
      phone: alert.phone,
      message,
      template: "stock.back",
      env,
    });
    rows(
      await db
        .from("back_in_stock_alerts")
        .update({ notified_at: nowIso() })
        .eq("id", alert.id)
        .select("id"),
    );
    notified += 1;
  }
  return notified;
}

export async function handleUnsubscribe(db, request) {
  const ipLimit = await limit(db, "unsubscribe", clientIp(request));
  if (ipLimit) return ipLimit;

  const body = parse(unsubscribeSchema, await readJson(request));
  const contact = body.contact.includes("@") ? canonicalEmail(body.contact) : canonicalPhone(body.contact);
  const contactLimit = await limit(db, "unsubscribe", contact);
  if (contactLimit) return contactLimit;

  rows(
    await db
      .from("marketing_suppressions")
      .insertIfAbsent(
        { contact, channel: "all", created_at: nowIso() },
        { onConflict: "contact" },
      )
      .select("contact"),
  );

  const column = contact.includes("@") ? "email" : "phone";
  const users = rows(
    await db.from("users").select("id").eq(column, contact).limit(1),
  );
  if (users.length === 1) {
    try {
      await db
        .from("users")
        .update({ marketing_opt_out: true, updated_at: nowIso() })
        .eq("id", users[0].id)
        .select("id");
    } catch {
      /* the suppression row already stops future campaigns */
    }
  }

  return json({ ok: true });
}

export async function handleCartReminder(db, request) {
  const ipLimit = await limit(db, "cart_reminder", clientIp(request));
  if (ipLimit) return ipLimit;

  const body = parse(cartReminderSchema, await readJson(request));
  const phoneLimit = await limit(db, "cart_reminder", body.phone);
  if (phoneLimit) return phoneLimit;

  rows(
    await db
      .from("cart_reminders")
      .insertIfAbsent(
        {
          id: newId(),
          phone: body.phone,
          item_count: body.itemCount,
          consent: true,
          created_at: nowIso(),
        },
        { onConflict: "id" },
      )
      .select("id"),
  );
  return json({ ok: true }, 201);
}

export async function handleAccountProfile(db, request, userId) {
  const body = parse(accountProfileSchema, await readJson(request));
  const patch = { updated_at: nowIso() };
  if (body.name !== undefined) patch.name = body.name;
  if (body.birthDate !== undefined) patch.birth_date = body.birthDate;

  const updated = rows(
    await db.from("users").update(patch).eq("id", userId).select("id,name,birth_date"),
  );
  if (updated.length !== 1) throw new AppError("not_found", 404);
  return json({ profile: { name: updated[0].name, birthDate: updated[0].birth_date ?? null } });
}

export async function handleAccountMe(db, request, userId) {
  const users = rows(
    await db.from("users").select("id,name,birth_date").eq("id", userId).limit(1),
  );
  if (users.length !== 1) throw new AppError("not_found", 404);
  return json({ profile: { name: users[0].name, birthDate: users[0].birth_date ?? null } });
}
