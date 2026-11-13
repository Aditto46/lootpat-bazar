// Server-side input validation. Every route body or query passes through a
// strict zod schema, so unknown fields are rejected instead of silently ignored.
import { z } from "./vendor/zod/index.js";
import { AppError } from "./http.mjs";
import { ASSIGNABLE_ROLES } from "./seed-data/rbac.mjs";

const encoder = new TextEncoder();

const nameValue = z.string().trim().min(2).max(80);
const passwordValue = z
  .string()
  .min(12)
  .max(128)
  .superRefine((value, context) => {
    if (encoder.encode(value).length > 256) {
      context.addIssue({ code: "custom", message: "password_too_long" });
    }
    if (!/\p{L}/u.test(value) || !/\d/u.test(value)) {
      context.addIssue({ code: "custom", message: "password_too_weak" });
    }
  });

const emailValue = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.string().email().max(254),
);

export function canonicalEmail(raw) {
  const result = emailValue.safeParse(raw);
  if (!result.success) throw new AppError("invalid_input", 400);
  return result.data;
}

// Accepts 01XXXXXXXXX, 8801XXXXXXXXX and +8801XXXXXXXXX and stores one form.
export function canonicalPhone(raw) {
  if (typeof raw !== "string") throw new AppError("invalid_input", 400);
  let value = raw.replace(/[\s()\-]/g, "");
  if (value.startsWith("8801")) value = `+${value}`;
  else if (value.startsWith("01")) value = `+880${value.slice(1)}`;
  if (!/^\+8801[3-9]\d{8}$/.test(value)) throw new AppError("invalid_input", 400);
  return value;
}

const phoneValue = z.string().trim().max(20).transform((value, context) => {
  try {
    return canonicalPhone(value);
  } catch {
    context.addIssue({ code: "custom", message: "invalid_phone" });
    return z.NEVER;
  }
});

const accountSchema = z
  .object({
    name: nameValue,
    email: emailValue.optional(),
    phone: phoneValue.optional(),
    password: passwordValue,
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.email && !value.phone) {
      context.addIssue({ code: "custom", message: "identifier_required" });
    }
  });

export const registerSchema = accountSchema;

export const loginSchema = z
  .object({
    identifier: z.string().trim().min(3).max(254).regex(/^[^\s<>"']+$/),
    password: z.string().min(1).max(254),
  })
  .strict();

export const setupSchema = z
  .object({
    owner: accountSchema.optional(),
  })
  .strict();

export const teamCreateSchema = z
  .object({
    name: nameValue,
    email: emailValue.optional(),
    phone: phoneValue.optional(),
    password: passwordValue,
    role: z.enum(ASSIGNABLE_ROLES),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.email && !value.phone) {
      context.addIssue({ code: "custom", message: "identifier_required" });
    }
  });

export const teamUpdateSchema = z
  .object({
    role: z.enum(ASSIGNABLE_ROLES).optional(),
    status: z.enum(["active", "suspended"]).optional(),
  })
  .strict()
  .refine((value) => value.role !== undefined || value.status !== undefined, {
    message: "nothing_to_update",
  });

// Step 9 — two-factor authentication, password rotation and account privacy.

const totpCodeValue = z.string().trim().regex(/^\d{6}$/);
const loginChallengeValue = z.string().trim().regex(/^[A-Za-z0-9_-]{43}$/);

export const twoFactorSetupSchema = z
  .object({
    password: z.string().min(1).max(254),
  })
  .strict();

export const twoFactorEnableSchema = z
  .object({
    code: totpCodeValue,
  })
  .strict();

export const twoFactorVerifySchema = z
  .object({
    password: z.string().min(1).max(254),
    code: totpCodeValue,
  })
  .strict();

export const twoFactorLoginSchema = z
  .object({
    challengeToken: loginChallengeValue,
    code: totpCodeValue.optional(),
    recoveryCode: z.string().trim().min(8).max(24).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.code) !== Boolean(value.recoveryCode), {
    message: "one_factor_required",
  });

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(254),
    newPassword: passwordValue,
  })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: "password_unchanged",
  });

export const teamPasswordResetSchema = z
  .object({
    password: passwordValue,
  })
  .strict();

export const accountDeleteSchema = z
  .object({
    password: z.string().min(1).max(254),
    confirm: z.literal("DELETE"),
  })
  .strict();

export const catalogQuerySchema = z
  .object({
    category: z.string().trim().max(40).optional(),
    q: z.string().trim().max(80).optional(),
    featured: z.enum(["true", "false"]).optional(),
    brand: z.string().trim().max(40).optional(),
    minPrice: z.coerce.number().int().min(0).max(10_000_000).optional(),
    maxPrice: z.coerce.number().int().min(0).max(10_000_000).optional(),
    rating: z.coerce.number().min(0).max(5).optional(),
    inStock: z.enum(["true", "false"]).optional(),
    option: z.string().trim().max(30).optional(),
    sort: z
      .enum(["relevance", "price-asc", "price-desc", "rating-desc", "discount-desc", "newest"])
      .optional(),
    limit: z.coerce.number().int().min(1).max(60).optional(),
  })
  .strict()
  .refine(
    (value) => value.minPrice === undefined || value.maxPrice === undefined || value.minPrice <= value.maxPrice,
    { message: "invalid_price_range" },
  );

export function parse(schema, input) {
  const result = schema.safeParse(input ?? {});
  if (!result.success) throw new AppError("invalid_input", 400);
  return result.data;
}

export function normalizeIdentifier(raw) {
  const value = String(raw).trim();
  return value.includes("@")
    ? { type: "email", value: canonicalEmail(value) }
    : { type: "phone", value: canonicalPhone(value) };
}

export function isUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  );
}

const uuidValue = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

const couponCodeValue = z
  .string()
  .trim()
  .min(3)
  .max(24)
  .regex(/^[A-Za-z0-9_-]+$/);

export const ORDER_NUMBER_PATTERN = /^LP-\d{6}-[0-9A-Z]{6}$/;

const checkoutItemSchema = z
  .object({
    productId: uuidValue,
    variantId: uuidValue.optional(),
    qty: z.number().int().min(1).max(20),
  })
  .strict();

const checkoutCustomerSchema = z
  .object({
    name: nameValue,
    phone: phoneValue,
    email: emailValue.optional(),
    districtId: z.string().trim().min(1).max(40).regex(/^[a-z0-9-]+$/),
    area: z.string().trim().min(2).max(80).optional(),
    address: z.string().trim().min(5).max(300),
    note: z.string().trim().max(300).optional(),
    marketingConsent: z.boolean().optional(),
  })
  .strict();

// The client owns presentation only: no prices, totals or shipping charges are
// accepted here, so a tampered cart cannot change what is charged.
export const checkoutSchema = z
  .object({
    items: z.array(checkoutItemSchema).min(1).max(20),
    customer: checkoutCustomerSchema,
    couponCode: couponCodeValue.optional(),
    paymentMethod: z.enum(["cod", "bkash", "nagad", "sslcommerz"]),
    idempotencyKey: uuidValue.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set();
    for (const item of value.items) {
      const key = `${item.productId}:${item.variantId ?? ""}`;
      if (seen.has(key)) {
        context.addIssue({ code: "custom", message: "duplicate_line" });
      }
      seen.add(key);
    }
  });

export const couponValidateSchema = z
  .object({
    code: couponCodeValue,
    subtotalPaisa: z.number().int().min(0).max(10_000_000),
  })
  .strict();

export const trackOrderSchema = z
  .object({
    orderNumber: z.string().trim().regex(ORDER_NUMBER_PATTERN),
    phone: phoneValue,
  })
  .strict();

// ---------------------------------------------------------------------------
// Admin authoring (Step 5). Money stays in integer paisa and images are limited
// to same-site paths or HTTPS URLs; binary upload is a separate, later step.

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "packed",
  "shipped",
  "delivered",
  "returned",
  "cancelled",
];

export const PAYMENT_STATUSES = ["unpaid", "pending", "paid", "failed", "refunded"];

const slugValue = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const skuValue = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

const imageValue = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .regex(/^(?:\/(?!\/)[^\s<>"'\\]+|https:\/\/[^\s<>"'\\]+)$/);

const optionalSwatch = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
);

export const productVariantInputSchema = z
  .object({
    id: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      .optional(),
    sku: skuValue.optional(),
    optionType: z.enum(["color", "size"]).default("color"),
    labelEn: z.string().trim().min(1).max(40),
    labelBn: z.string().trim().min(1).max(40),
    pricePaisa: z.number().int().min(100).max(10_000_000),
    stock: z.number().int().min(0).max(1_000_000),
    swatch: optionalSwatch,
    position: z.number().int().min(0).max(30).optional(),
  })
  .strict();

const productCreateFields = {
  nameBn: z.string().trim().min(2).max(80),
  nameEn: z.string().trim().min(2).max(80),
  slug: slugValue.optional(),
  categoryId: z.string().trim().min(1).max(40).regex(/^[a-z0-9-]+$/),
  brand: z.string().trim().min(1).max(40).default("LootPat Bazar"),
  taglineBn: z.string().trim().max(160).default(""),
  taglineEn: z.string().trim().max(160).default(""),
  descriptionBn: z.string().trim().max(2000).default(""),
  descriptionEn: z.string().trim().max(2000).default(""),
  pricePaisa: z.number().int().min(100).max(10_000_000),
  compareAtPaisa: z.number().int().min(0).max(10_000_000).nullable().optional(),
  stock: z.number().int().min(0).max(1_000_000).optional(),
  lowStockThreshold: z.number().int().min(0).max(10_000).optional(),
  badge: z.enum(["bestseller", "new", "limited"]).nullable().optional(),
  image: imageValue,
  imageSmall: imageValue.optional(),
  featured: z.boolean().default(false),
  status: z.enum(["draft", "active"]).default("draft"),
};

export const productCreateSchema = z
  .object({
    ...productCreateFields,
    variants: z.array(productVariantInputSchema).max(10).default([]),
  })
  .strict()
  .refine(
    (value) => value.compareAtPaisa == null || value.compareAtPaisa >= value.pricePaisa,
    { message: "compare_at_below_price" },
  );

export const productUpdateSchema = z
  .object({
    nameBn: productCreateFields.nameBn.optional(),
    nameEn: productCreateFields.nameEn.optional(),
    slug: slugValue.optional(),
    categoryId: productCreateFields.categoryId.optional(),
    brand: z.string().trim().min(1).max(40).optional(),
    taglineBn: z.string().trim().max(160).optional(),
    taglineEn: z.string().trim().max(160).optional(),
    descriptionBn: z.string().trim().max(2000).optional(),
    descriptionEn: z.string().trim().max(2000).optional(),
    pricePaisa: z.number().int().min(100).max(10_000_000).optional(),
    compareAtPaisa: z.number().int().min(0).max(10_000_000).nullable().optional(),
    stock: z.number().int().min(0).max(1_000_000).optional(),
    lowStockThreshold: z.number().int().min(0).max(10_000).optional(),
    badge: z.enum(["bestseller", "new", "limited"]).nullable().optional(),
    image: imageValue.optional(),
    imageSmall: imageValue.optional(),
    featured: z.boolean().optional(),
    status: z.enum(["draft", "active"]).optional(),
    variants: z.array(productVariantInputSchema).max(10).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "nothing_to_update" });

export const productImportSchema = z
  .object({
    rows: z.array(z.unknown()).min(1).max(50),
    publish: z.boolean().optional(),
  })
  .strict();

export const adminImportRowSchema = z
  .object({
    nameEn: z.string().trim().min(2).max(80),
    nameBn: z.string().trim().min(2).max(80),
    categoryId: z.string().trim().min(1).max(40).regex(/^[a-z0-9-]+$/),
    pricePaisa: z.number().int().min(100).max(10_000_000),
    stock: z.number().int().min(0).max(1_000_000).default(0),
    brand: z.string().trim().min(1).max(40).default("LootPat Bazar"),
    taglineEn: z.string().trim().max(160).default(""),
    taglineBn: z.string().trim().max(160).default(""),
    descriptionEn: z.string().trim().max(2000).default(""),
    descriptionBn: z.string().trim().max(2000).default(""),
    badge: z.enum(["bestseller", "new", "limited"]).nullable().optional(),
    featured: z.boolean().default(false),
    image: imageValue.optional(),
    sku: skuValue.optional(),
    optionType: z.enum(["color", "size"]).optional(),
    variantLabelEn: z.string().trim().min(1).max(40).optional(),
    variantLabelBn: z.string().trim().min(1).max(40).optional(),
    variantPricePaisa: z.number().int().min(100).max(10_000_000).optional(),
    variantStock: z.number().int().min(0).max(1_000_000).optional(),
    swatch: optionalSwatch,
  })
  .strict()
  .superRefine((value, context) => {
    const variantFields = [
      value.sku,
      value.variantLabelEn,
      value.variantLabelBn,
      value.variantPricePaisa,
      value.variantStock,
    ].filter((field) => field !== undefined);
    if (variantFields.length > 0 && (!value.variantLabelEn || !value.variantLabelBn)) {
      context.addIssue({ code: "custom", message: "variant_labels_required" });
    }
  });

export const adminOrdersQuerySchema = z
  .object({
    status: z.enum(ORDER_STATUSES).optional(),
    q: z.string().trim().max(80).optional(),
  })
  .strict();

export const adminProductsQuerySchema = z
  .object({
    status: z.enum(["draft", "active", "archived"]).optional(),
    q: z.string().trim().max(80).optional(),
  })
  .strict();

export const adminOrderStatusSchema = z
  .object({
    status: z.enum(ORDER_STATUSES),
    note: z.string().trim().max(200).optional(),
  })
  .strict();

export const adminPaymentStatusSchema = z
  .object({
    paymentStatus: z.enum(PAYMENT_STATUSES),
    note: z.string().trim().max(200).optional(),
  })
  .strict();

export const adminAuditQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    action: z.string().trim().regex(/^[a-z0-9._-]{3,60}$/).optional(),
    actorId: z.string().trim().uuid().optional(),
    q: z.string().trim().max(80).optional(),
    from: z.string().trim().datetime({ offset: true }).optional(),
    to: z.string().trim().datetime({ offset: true }).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Step 6 — online payments, courier handoff and editable store settings.

const settingsText = (max, min = 0) => z.string().trim().min(min).max(max);
const settingsPhone = z
  .string()
  .trim()
  .min(6)
  .max(24)
  .regex(/^\+?[0-9][0-9\s()-]*$/);
const settingsPaisa = z.number().int().min(0).max(10_000_000);

export const adminSettingsSchema = z
  .object({
    store: z
      .object({
        nameBn: settingsText(80, 2).optional(),
        nameEn: settingsText(80, 2).optional(),
        phone: settingsPhone.optional(),
        email: z.string().trim().email().max(254).optional(),
        addressBn: settingsText(200).optional(),
        addressEn: settingsText(200).optional(),
        tradeLicense: settingsText(60).optional(),
        tin: settingsText(30).optional(),
      })
      .strict()
      .optional(),
    delivery: z
      .object({
        dhakaChargePaisa: settingsPaisa.optional(),
        outsideChargePaisa: settingsPaisa.optional(),
        freeThresholdPaisa: settingsPaisa.optional(),
        codLimitPaisa: settingsPaisa.optional(),
        codEnabled: z.boolean().optional(),
      })
      .strict()
      .optional(),
    payments: z
      .object({
        bkashEnabled: z.boolean().optional(),
        nagadEnabled: z.boolean().optional(),
        sslcommerzEnabled: z.boolean().optional(),
      })
      .strict()
      .optional(),
    security: z
      .object({
        ipAllowlist: z.string().trim().max(500).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => value.store || value.delivery || value.payments || value.security, {
    message: "nothing_to_update",
  });

const lookupTokenValue = z.string().trim().min(20).max(80).regex(/^[A-Za-z0-9_-]+$/);

export const paymentSessionSchema = z
  .object({
    orderNumber: z.string().trim().regex(ORDER_NUMBER_PATTERN),
    lookupToken: lookupTokenValue,
    provider: z.enum(["bkash", "nagad", "sslcommerz"]),
  })
  .strict();

export const paymentVerifySchema = z
  .object({
    orderNumber: z.string().trim().regex(ORDER_NUMBER_PATTERN),
    lookupToken: lookupTokenValue,
    sessionId: uuidValue,
    providerReference: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const sandboxCompleteSchema = z
  .object({
    token: lookupTokenValue,
    outcome: z.enum(["success", "failure"]),
  })
  .strict();

export const paymentWebhookSchema = z
  .object({
    eventId: z.string().trim().min(3).max(100).regex(/^[A-Za-z0-9:_-]+$/),
    event: z.enum(["payment.paid", "payment.failed"]),
    orderNumber: z.string().trim().regex(ORDER_NUMBER_PATTERN),
    amountPaisa: z.number().int().min(0).max(10_000_000),
    providerRef: z.string().trim().min(1).max(120),
  })
  .strict();

export const courierAssignSchema = z
  .object({
    courier: z.enum(["manual", "pathao", "redx", "steadfast"]),
    trackingNumber: z
      .string()
      .trim()
      .min(3)
      .max(60)
      .regex(/^[A-Za-z0-9-]+$/)
      .optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Step 7 — live support chat, assistant and the staff inbox.

const supportTokenValue = z.string().trim().min(20).max(120).regex(/^[A-Za-z0-9_-]+$/);
const supportBody = z.string().trim().min(1).max(1000);
const supportLocale = z.enum(["bn", "en"]);

export const supportStartSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    phone: phoneValue.optional(),
    orderNumber: z.string().trim().regex(ORDER_NUMBER_PATTERN).optional(),
    message: supportBody,
    locale: supportLocale.optional(),
  })
  .strict();

export const supportMessageSchema = z
  .object({
    token: supportTokenValue,
    message: supportBody,
    locale: supportLocale.optional(),
  })
  .strict();

export const supportTokenSchema = z.object({ token: supportTokenValue }).strict();

export const supportFaqQuerySchema = z
  .object({ locale: supportLocale.optional() })
  .strict();

export const adminSupportQuerySchema = z
  .object({
    status: z.enum(["bot", "waiting", "open", "resolved"]).optional(),
    q: z.string().trim().max(80).optional(),
  })
  .strict();

export const adminSupportReplySchema = z
  .object({
    body: supportBody.optional(),
    cannedId: z.string().trim().min(2).max(60).optional(),
  })
  .strict()
  .refine((value) => value.body !== undefined || value.cannedId !== undefined, {
    message: "nothing_to_update",
  });

export const adminSupportAssignSchema = z.object({ assigneeId: uuidValue }).strict();

export const adminCannedCreateSchema = z
  .object({
    title: z.string().trim().min(2).max(80),
    body: supportBody,
    locale: supportLocale,
  })
  .strict();

// ---------------------------------------------------------------------------
// Step 8 — reviews, marketing, loyalty and customer segments.

const isoDateValue = z
  .string()
  .trim()
  .min(10)
  .max(40)
  .refine((value) => Number.isFinite(Date.parse(value)), { message: "invalid_date" });

const optionalIsoDate = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  isoDateValue.optional(),
);

// Photos arrive as base64 data URLs, never as remote URLs: the server checks the
// declared type, the decoded magic bytes and the size before storing anything.
const reviewPhotoValue = z
  .string()
  .min(40)
  .max(400_000)
  .regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/);

export const REVIEW_STATUSES = ["pending", "approved", "rejected"];

export const reviewCreateSchema = z
  .object({
    productId: uuidValue,
    orderNumber: z.string().trim().regex(ORDER_NUMBER_PATTERN),
    phone: phoneValue,
    rating: z.number().int().min(1).max(5),
    title: z.string().trim().max(80).optional(),
    body: z.string().trim().min(5).max(1200),
    photos: z.array(reviewPhotoValue).max(2).default([]),
  })
  .strict();

export const reviewHelpfulSchema = z
  .object({ voterKey: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/) })
  .strict();

export const spinPlaySchema = z
  .object({ visitorKey: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/) })
  .strict();

export const backInStockSchema = z
  .object({ productId: uuidValue, phone: phoneValue })
  .strict();

export const unsubscribeSchema = z
  .object({ contact: z.string().trim().min(5).max(254) })
  .strict();

export const cartReminderSchema = z
  .object({
    phone: phoneValue,
    itemCount: z.number().int().min(1).max(50),
    consent: z.literal(true),
  })
  .strict();

export const loyaltyRedeemSchema = z
  .object({ points: z.number().int().min(100).max(100_000) })
  .strict();

export const accountProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    birthDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.birthDate !== undefined, {
    message: "nothing_to_update",
  });

const couponKindValue = z.enum(["percent", "fixed", "free_shipping"]);
const couponLimitValue = z.number().int().min(1).max(1_000_000).nullable().optional();

const couponFields = {
  code: couponCodeValue,
  kind: couponKindValue,
  value: z.number().int().min(0).max(10_000_000),
  minSubtotalPaisa: z.number().int().min(0).max(10_000_000).default(0),
  maxDiscountPaisa: z.number().int().min(0).max(10_000_000).nullable().optional(),
  usageLimit: couponLimitValue,
  perCustomerLimit: couponLimitValue,
  startsAt: optionalIsoDate,
  endsAt: optionalIsoDate,
  active: z.boolean().default(true),
};

export const adminCouponCreateSchema = z
  .object(couponFields)
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "percent" && (value.value < 1 || value.value > 90)) {
      context.addIssue({ code: "custom", message: "invalid_percent" });
    }
    if (value.kind === "fixed" && value.value < 100) {
      context.addIssue({ code: "custom", message: "invalid_fixed_value" });
    }
    if (value.kind === "free_shipping" && value.value !== 0) {
      context.addIssue({ code: "custom", message: "invalid_free_shipping_value" });
    }
    if (
      value.startsAt &&
      value.endsAt &&
      Date.parse(value.endsAt) <= Date.parse(value.startsAt)
    ) {
      context.addIssue({ code: "custom", message: "invalid_window" });
    }
  });

export const adminCouponUpdateSchema = z
  .object({
    kind: couponKindValue.optional(),
    value: z.number().int().min(0).max(10_000_000).optional(),
    minSubtotalPaisa: z.number().int().min(0).max(10_000_000).optional(),
    maxDiscountPaisa: z.number().int().min(0).max(10_000_000).nullable().optional(),
    usageLimit: couponLimitValue,
    perCustomerLimit: couponLimitValue,
    startsAt: isoDateValue.nullable().optional(),
    endsAt: isoDateValue.nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "nothing_to_update" });

export const adminFlashSaleCreateSchema = z
  .object({
    titleBn: z.string().trim().min(2).max(80),
    titleEn: z.string().trim().min(2).max(80),
    subtitleBn: z.string().trim().max(200).default(""),
    subtitleEn: z.string().trim().max(200).default(""),
    discountPercent: z.number().int().min(1).max(90),
    startsAt: isoDateValue,
    endsAt: isoDateValue,
    status: z.enum(["draft", "active", "ended"]).default("draft"),
    bannerImage: imageValue.nullable().optional(),
    productIds: z.array(uuidValue).max(12).default([]),
  })
  .strict()
  .refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), {
    message: "invalid_window",
  });

export const adminFlashSaleUpdateSchema = z
  .object({
    titleBn: z.string().trim().min(2).max(80).optional(),
    titleEn: z.string().trim().min(2).max(80).optional(),
    subtitleBn: z.string().trim().max(200).optional(),
    subtitleEn: z.string().trim().max(200).optional(),
    discountPercent: z.number().int().min(1).max(90).optional(),
    startsAt: isoDateValue.optional(),
    endsAt: isoDateValue.optional(),
    status: z.enum(["draft", "active", "ended"]).optional(),
    bannerImage: imageValue.nullable().optional(),
    productIds: z.array(uuidValue).max(12).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "nothing_to_update" });

export const adminSpinPrizeSchema = z
  .object({
    id: z.string().trim().min(2).max(40).regex(/^[a-z0-9-]+$/).optional(),
    labelBn: z.string().trim().min(1).max(40),
    labelEn: z.string().trim().min(1).max(40),
    kind: couponKindValue,
    value: z.number().int().min(0).max(1_000_000),
    weight: z.number().int().min(1).max(100),
    active: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "percent" && (value.value < 1 || value.value > 90)) {
      context.addIssue({ code: "custom", message: "invalid_percent" });
    }
    if (value.kind === "fixed" && value.value < 100) {
      context.addIssue({ code: "custom", message: "invalid_fixed_value" });
    }
    if (value.kind === "free_shipping" && value.value !== 0) {
      context.addIssue({ code: "custom", message: "invalid_free_shipping_value" });
    }
  });

export const adminSpinUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    prizes: z.array(adminSpinPrizeSchema).max(6).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "nothing_to_update" });

export const adminCampaignCreateSchema = z
  .object({
    channel: z.enum(["sms", "email"]),
    subject: z.string().trim().max(120).default(""),
    body: z.string().trim().min(5).max(1000),
    audience: z.enum(["all", "vip", "inactive"]),
    send: z.boolean().default(false),
  })
  .strict()
  .refine((value) => value.channel !== "email" || value.subject.length >= 2, {
    message: "subject_required",
  });

export const adminReviewQuerySchema = z
  .object({ status: z.enum(REVIEW_STATUSES).optional() })
  .strict();

export const adminReviewUpdateSchema = z
  .object({
    status: z.enum(["approved", "rejected"]).optional(),
    reply: z.string().trim().max(600).optional(),
  })
  .strict()
  .refine((value) => value.status !== undefined || value.reply !== undefined, {
    message: "nothing_to_update",
  });

export const adminCustomersQuerySchema = z
  .object({
    q: z.string().trim().max(80).optional(),
    segment: z.enum(["all", "vip", "inactive", "new"]).optional(),
  })
  .strict();

export const adminCustomerUpdateSchema = z
  .object({
    action: z.enum(["block", "unblock", "note"]),
    reason: z.string().trim().max(200).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === "note" && !value.note) {
      context.addIssue({ code: "custom", message: "note_required" });
    }
  });

const bannerHrefValue = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^(?:\/(?!\/)[^\s<>"'\\]*|https:\/\/[^\s<>"'\\]+)$/);

export const adminBannerCreateSchema = z
  .object({
    titleBn: z.string().trim().min(2).max(80),
    titleEn: z.string().trim().min(2).max(80),
    bodyBn: z.string().trim().max(200).default(""),
    bodyEn: z.string().trim().max(200).default(""),
    ctaLabelBn: z.string().trim().max(40).default(""),
    ctaLabelEn: z.string().trim().max(40).default(""),
    href: bannerHrefValue.default("/shop"),
    tone: z.enum(["teal", "violet", "gold", "rose"]).default("teal"),
    active: z.boolean().default(true),
    position: z.number().int().min(0).max(20).default(0),
    startsAt: optionalIsoDate,
    endsAt: optionalIsoDate,
  })
  .strict();

export const adminBannerUpdateSchema = z
  .object({ active: z.boolean() })
  .strict();
