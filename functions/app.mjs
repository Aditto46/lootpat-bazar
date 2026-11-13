// Application routes. Identity and authorization come only from the opaque
// session cookie and the database; nothing in the request body can set a role,
// an owner id or a price.
import {
  AppError,
  applicationPath,
  clientIp,
  errorJson,
  json,
  readJson,
  requireTrustedOrigin,
  rows,
  secureCompare,
} from "./http.mjs";
import {
  catalogQuerySchema,
  isUuid,
  loginSchema,
  normalizeIdentifier,
  parse,
  registerSchema,
  setupSchema,
  teamCreateSchema,
  teamUpdateSchema,
  twoFactorLoginSchema,
} from "./validate.mjs";
import {
  hashPassword,
  verifyPassword,
  verifyPasswordAgainstDummy,
} from "./passwords.mjs";
import {
  CUSTOMER_SESSION_TTL_MS,
  STAFF_SESSION_TTL_MS,
  clearSessionCookie,
  createSession,
  revokeAllSessions,
  revokeSession,
  sessionCookie,
  validateSession,
} from "./sessions.mjs";
import { consume } from "./limiter.mjs";
import { recordAudit, recordSystemAudit } from "./audit.mjs";
import {
  CUSTOMER_ROLE,
  OWNER_ROLE,
  loadPrincipal,
  publicPrincipal,
  requireOwner,
  requirePermission,
} from "./rbac.mjs";
import { ASSIGNABLE_ROLES } from "./seed-data/rbac.mjs";
import { seedBaseline } from "./seed.mjs";
import {
  handleAccountOrders,
  handleCheckoutConfig,
  handleCouponValidate,
  handleCreateOrder,
  handleOrderLookup,
  handleTrackOrder,
} from "./checkout.mjs";
import {
  handleAdminAudit,
  handleAdminAuditExport,
  handleAdminDashboard,
  handleAdminOrderDetail,
  handleAdminOrders,
  handleAdminOrderStatus,
  handleAdminPaymentStatus,
  handleAdminProductDetail,
  handleAdminProducts,
  handleProductArchive,
  handleProductCreate,
  handleProductImport,
  handleProductUpdate,
} from "./admin.mjs";
import {
  handleCreatePaymentSession,
  handlePaymentSessionInfo,
  handlePaymentVerify,
  handlePaymentWebhook,
  handleSandboxComplete,
} from "./payments.mjs";
import { handleAssignCourier } from "./courier.mjs";
import { handleAdminSettings, handleAdminSettingsUpdate } from "./settings.mjs";
import {
  handleAccountMe,
  handleAccountProfile,
  handleBackInStockRequest,
  handleBanners,
  handleCartReminder,
  handleFlashSale,
  handleLoyalty,
  handleLoyaltyRedeem,
  handleProductReviews,
  handleReviewCreate,
  handleReviewHelpful,
  handleSpinPlay,
  handleSpinPublic,
  handleUnsubscribe,
} from "./marketing.mjs";
import {
  handleAdminBannerCreate,
  handleAdminBanners,
  handleAdminBannerUpdate,
  handleAdminCampaignCreate,
  handleAdminCampaigns,
  handleAdminCouponCreate,
  handleAdminCoupons,
  handleAdminCouponUpdate,
  handleAdminCustomerDetail,
  handleAdminCustomers,
  handleAdminCustomerUpdate,
  handleAdminFlashSaleCreate,
  handleAdminFlashSales,
  handleAdminFlashSaleUpdate,
  handleAdminReviewUpdate,
  handleAdminReviews,
  handleAdminSpin,
  handleAdminSpinUpdate,
} from "./admin-marketing.mjs";
import {
  handleAdminCannedCreate,
  handleAdminCannedList,
  handleAdminSupportAssign,
  handleAdminSupportClose,
  handleAdminSupportDetail,
  handleAdminSupportInbox,
  handleAdminSupportReply,
  handleSupportFaq,
  handleSupportHandoff,
  handleSupportMessage,
  handleSupportSession,
  handleSupportStart,
} from "./support.mjs";
import {
  consumeLoginChallenge,
  createLoginChallenge,
  enforceAdminNetwork,
  handleAccountDataExport,
  handleAccountDelete,
  handleAdminCustomerExport,
  handleBackupCreate,
  handleBackupDownload,
  handleBackupList,
  handlePasswordChange,
  handleRecoveryRegenerate,
  handleTeamPasswordReset,
  handleTeamTwoFactorReset,
  handleTwoFactorDisable,
  handleTwoFactorEnable,
  handleTwoFactorSetup,
  handleTwoFactorStatus,
  readLoginChallenge,
  recordChallengeFailure,
  verifySecondFactor,
} from "./security.mjs";

const USER_COLUMNS =
  "id,name,email,phone,role_id,password_salt,password_hash,password_iterations,status,last_login_at,created_at,deleted_at,two_factor_secret,two_factor_enabled_at";
const PRODUCT_COLUMNS =
  "id,slug,category_id,brand,name_bn,name_en,tagline_bn,tagline_en,description_bn,description_en,price_paisa,compare_at_paisa,stock,low_stock_threshold,rating_tenths,reviews,badge,image,image_small,status,featured,created_at,deleted_at";
const VARIANT_COLUMNS =
  "id,product_id,sku,option_type,option_label_bn,option_label_en,price_paisa,stock,sort_order,swatch";
const TEAM_COLUMNS =
  "id,name,email,phone,role_id,status,last_login_at,created_at,deleted_at,two_factor_enabled_at";

const retryAfter = (result) => ({
  "retry-after": String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))),
});

const rateLimited = (result) => errorJson("rate_limited", 429, retryAfter(result));

function secureFor(origin) {
  return typeof origin === "string" && origin.startsWith("https://");
}

async function roleExists(db, roleId) {
  const found = rows(await db.from("roles").select("id").eq("id", roleId).limit(1));
  return found.length === 1;
}

async function findUserByIdentifier(db, identifier) {
  const column = identifier.type === "email" ? "email" : "phone";
  return rows(
    await db.from("users").select(USER_COLUMNS).eq(column, identifier.value).limit(1),
  );
}

async function findUserById(db, userId) {
  const found = rows(await db.from("users").select(USER_COLUMNS).eq("id", userId).limit(1));
  return found.length === 1 ? found[0] : null;
}

async function createAccount(db, { name, email, phone, password, roleId }) {
  if (!(await roleExists(db, roleId))) throw new AppError("setup_required", 409);

  if (email) {
    const taken = rows(await db.from("users").select("id").eq("email", email).limit(1));
    if (taken.length > 0) throw new AppError("account_exists", 409);
  }
  if (phone) {
    const taken = rows(await db.from("users").select("id").eq("phone", phone).limit(1));
    if (taken.length > 0) throw new AppError("account_exists", 409);
  }

  const derived = await hashPassword(password);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const created = rows(
    await db
      .from("users")
      .insertIfAbsent(
        {
          id,
          name,
          email: email ?? null,
          phone: phone ?? null,
          role_id: roleId,
          password_salt: derived.salt,
          password_hash: derived.hash,
          password_iterations: derived.iterations,
          status: "active",
          last_login_at: null,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        },
        { onConflict: email ? "email" : "phone" },
      )
      .select("id"),
  );
  if (created.length !== 1) throw new AppError("account_exists", 409);
  return { id };
}

async function issueSession(db, request, userId, ttlMs, origin) {
  const session = await createSession(db, userId, {
    ttlMs,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
  });
  const seconds = Math.floor(ttlMs / 1000);
  return { session, cookie: sessionCookie(session.token, seconds, secureFor(origin)) };
}

async function sessionPrincipal(db, request) {
  const result = await validateSession(db, request);
  if (result.state !== "valid" || !result.session) {
    throw new SessionRequired(result.state);
  }
  const principal = await loadPrincipal(db, result.session.userId);
  return { principal, session: result.session };
}

// Checkout works for guests, so a missing or expired session is not an error:
// it simply means the order will not be linked to an account.
async function optionalUserId(db, request) {
  const result = await validateSession(db, request);
  if (result.state !== "valid" || !result.session) return null;
  return result.session.userId;
}

class SessionRequired extends Error {
  constructor(state) {
    super("login_required");
    this.state = state;
  }
}

function unauthorized(state, origin) {
  return state === "invalid"
    ? errorJson("login_required", 401, { "set-cookie": clearSessionCookie(secureFor(origin)) })
    : errorJson("login_required", 401);
}

function publicVariant(row) {
  return {
    id: row.id,
    sku: row.sku,
    optionType: row.option_type,
    label: { bn: row.option_label_bn, en: row.option_label_en },
    pricePaisa: row.price_paisa,
    stock: row.stock,
    swatch: row.swatch ?? null,
  };
}

function publicProduct(row, variants = []) {
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
    variants: variants.map(publicVariant),
  };
}

async function register(db, request, origin) {
  const body = parse(registerSchema, await readJson(request));
  const ipLimit = await consume(db, "register_ip", clientIp(request));
  if (!ipLimit.allowed) return rateLimited(ipLimit);
  const identityLimit = await consume(db, "register", body.email ?? body.phone);
  if (!identityLimit.allowed) return rateLimited(identityLimit);

  const account = await createAccount(db, {
    name: body.name,
    email: body.email,
    phone: body.phone,
    password: body.password,
    roleId: CUSTOMER_ROLE,
  });
  const { cookie } = await issueSession(db, request, account.id, CUSTOMER_SESSION_TTL_MS, origin);
  const principal = await loadPrincipal(db, account.id);
  return json({ user: publicPrincipal(principal) }, 201, { "set-cookie": cookie });
}

async function login(db, request, origin) {
  const body = parse(loginSchema, await readJson(request));
  const identifier = normalizeIdentifier(body.identifier);

  const identityLimit = await consume(db, "login", identifier.value);
  if (!identityLimit.allowed) return rateLimited(identityLimit);
  const ipLimit = await consume(db, "login_ip", clientIp(request));
  if (!ipLimit.allowed) return rateLimited(ipLimit);

  const found = await findUserByIdentifier(db, identifier);
  if (found.length !== 1 || found[0].deleted_at != null) {
    await verifyPasswordAgainstDummy(body.password);
    return errorJson("invalid_credentials", 401);
  }

  const user = found[0];
  const ok = await verifyPassword(body.password, {
    salt: user.password_salt,
    hash: user.password_hash,
    iterations: user.password_iterations,
  });
  if (!ok) return errorJson("invalid_credentials", 401);

  if (user.status !== "active") {
    await revokeAllSessions(db, user.id);
    return errorJson("account_suspended", 403);
  }

  const roles = rows(await db.from("roles").select("id,is_staff").eq("id", user.role_id).limit(1));
  if (roles.length !== 1) throw new AppError("role_unavailable", 503);
  const ttlMs = roles[0].is_staff ? STAFF_SESSION_TTL_MS : CUSTOMER_SESSION_TTL_MS;
  const isPrivileged =
    roles[0].is_staff && (user.role_id === OWNER_ROLE || user.role_id === "admin");

  // A second factor replaces the password-only session: the challenge is the
  // only thing issued until a TOTP code or recovery code is verified.
  if (user.two_factor_enabled_at != null && typeof user.two_factor_secret === "string") {
    const challenge = await createLoginChallenge(db, request, user.id);
    return json({
      twoFactorRequired: true,
      challengeToken: challenge.challengeToken,
      expiresAt: challenge.expiresAt,
    });
  }

  await markLastLogin(db, user.id);
  const { cookie } = await issueSession(db, request, user.id, ttlMs, origin);
  const principal = await loadPrincipal(db, user.id);
  if (principal.role.is_staff) {
    await recordAudit(db, request, principal, {
      action: "auth.login",
      entityType: "user",
      entityId: user.id,
      summary: "Password sign-in",
      details: { twoFactor: false },
    });
  }
  return json(
    { user: publicPrincipal(principal), twoFactorSetupRequired: isPrivileged },
    200,
    { "set-cookie": cookie },
  );
}

async function markLastLogin(db, userId) {
  const now = new Date().toISOString();
  try {
    await db.from("users").update({ last_login_at: now, updated_at: now }).eq("id", userId).select("id");
  } catch {
    // Signing in must not fail because a profile timestamp could not be written.
  }
}

async function loginTwoFactor(db, request, origin) {
  const body = parse(twoFactorLoginSchema, await readJson(request));
  const identityLimit = await consume(db, "login_2fa", body.challengeToken);
  if (!identityLimit.allowed) return rateLimited(identityLimit);
  const ipLimit = await consume(db, "login_2fa_ip", clientIp(request));
  if (!ipLimit.allowed) return rateLimited(ipLimit);

  const challenge = await readLoginChallenge(db, body.challengeToken);
  if (!challenge) return errorJson("invalid_challenge", 401);

  const user = await findUserById(db, challenge.userId);
  if (
    !user ||
    user.deleted_at != null ||
    user.status !== "active" ||
    user.two_factor_enabled_at == null ||
    typeof user.two_factor_secret !== "string"
  ) {
    return errorJson("invalid_challenge", 401);
  }

  const verified = await verifySecondFactor(db, user, {
    code: body.code,
    recoveryCode: body.recoveryCode,
  });
  if (!verified) {
    await recordChallengeFailure(db, challenge.digest, challenge.attempts);
    await recordSystemAudit(db, {
      action: "auth.2fa_failed",
      entityType: "user",
      entityId: user.id,
      summary: "Second factor rejected",
      details: { method: body.recoveryCode ? "recovery_code" : "totp" },
      ip: clientIp(request),
    });
    return errorJson("invalid_code", 401);
  }

  await consumeLoginChallenge(db, challenge.digest);
  await markLastLogin(db, user.id);
  const roles = rows(await db.from("roles").select("id,is_staff").eq("id", user.role_id).limit(1));
  if (roles.length !== 1) throw new AppError("role_unavailable", 503);
  const ttlMs = roles[0].is_staff ? STAFF_SESSION_TTL_MS : CUSTOMER_SESSION_TTL_MS;
  const { cookie } = await issueSession(db, request, user.id, ttlMs, origin);
  const principal = await loadPrincipal(db, user.id);
  await recordAudit(db, request, principal, {
    action: "auth.login",
    entityType: "user",
    entityId: user.id,
    summary: "Two-factor sign-in",
    details: { twoFactor: true, method: body.recoveryCode ? "recovery_code" : "totp" },
  });
  return json(
    { user: publicPrincipal(principal), twoFactorSetupRequired: false },
    200,
    { "set-cookie": cookie },
  );
}

async function logout(db, request, origin) {
  const result = await validateSession(db, request);
  if (result.state === "valid" && result.session) {
    try {
      await revokeSession(db, result.session.digest);
    } catch {
      return errorJson("logout_unconfirmed", 503);
    }
  }
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie(secureFor(origin)) });
}

async function setup(db, request, config) {
  if (config.setupToken) {
    const supplied = request.headers.get("x-setup-token") ?? "";
    if (!(await secureCompare(supplied, config.setupToken))) throw new AppError("setup_forbidden", 403);
  } else {
    // Without a token the very first run is still possible, but only while no
    // account exists; after that setup is locked and needs the token again.
    const existing = rows(await db.from("users").select("id").limit(1));
    if (existing.length > 0) throw new AppError("setup_forbidden", 403);
  }

  const limit = await consume(db, "setup", clientIp(request));
  if (!limit.allowed) return rateLimited(limit);

  const body = parse(setupSchema, await readJson(request));
  const summary = await seedBaseline(db);

  let owner = null;
  const owners = rows(await db.from("users").select("id").eq("role_id", OWNER_ROLE).limit(1));
  if (body.owner && owners.length === 0) {
    const created = await createAccount(db, {
      name: body.owner.name,
      email: body.owner.email,
      phone: body.owner.phone,
      password: body.owner.password,
      roleId: OWNER_ROLE,
    });
    owner = { id: created.id, email: body.owner.email ?? null, phone: body.owner.phone ?? null };
  }

  return json({
    ok: true,
    seeded: summary,
    ownerCreated: Boolean(owner),
    owner,
    ownerExists: owner === null && owners.length > 0,
  });
}

async function listTeam(db) {
  const users = rows(await db.from("users").select(TEAM_COLUMNS).limit(500));
  const roles = rows(await db.from("roles").select("id,name_bn,name_en,level,is_staff").limit(20));
  const roleById = new Map(roles.map((role) => [role.id, role]));
  return users
    .filter((user) => user.deleted_at == null && user.role_id !== CUSTOMER_ROLE)
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
    .map((user) => {
      const role = roleById.get(user.role_id) ?? null;
      return {
        id: user.id,
        name: user.name,
        email: user.email ?? null,
        phone: user.phone ?? null,
        status: user.status,
        lastLoginAt: user.last_login_at ?? null,
        createdAt: user.created_at,
        twoFactorEnabled: user.two_factor_enabled_at != null,
        role: role
          ? { id: role.id, name_bn: role.name_bn, name_en: role.name_en, level: role.level }
          : { id: user.role_id, name_bn: user.role_id, name_en: user.role_id, level: 0 },
      };
    });
}

async function createTeamMember(db, request) {
  const body = parse(teamCreateSchema, await readJson(request));
  if (!ASSIGNABLE_ROLES.includes(body.role)) throw new AppError("invalid_input", 400);
  const created = await createAccount(db, {
    name: body.name,
    email: body.email,
    phone: body.phone,
    password: body.password,
    roleId: body.role,
  });
  return json({ ok: true, id: created.id, role: body.role }, 201);
}

async function updateTeamMember(db, teamId, request, principal) {
  if (teamId === principal.user.id) throw new AppError("cannot_modify_self", 409);
  const target = await findUserById(db, teamId);
  if (!target || target.deleted_at != null) throw new AppError("not_found", 404);
  if (target.role_id === OWNER_ROLE) throw new AppError("cannot_modify_owner", 409);

  const body = parse(teamUpdateSchema, await readJson(request));
  if (body.role !== undefined && !ASSIGNABLE_ROLES.includes(body.role)) {
    throw new AppError("invalid_input", 400);
  }

  const patch = { updated_at: new Date().toISOString() };
  if (body.role !== undefined) patch.role_id = body.role;
  if (body.status !== undefined) patch.status = body.status;

  const updated = rows(
    await db.from("users").update(patch).eq("id", teamId).select(TEAM_COLUMNS),
  );
  if (updated.length !== 1) throw new AppError("update_unconfirmed", 503);

  // A suspended or re-roled account must lose its existing sessions at once.
  const revoked = await revokeAllSessions(db, teamId);
  return json({ ok: true, user: { id: teamId, role: updated[0].role_id, status: updated[0].status }, revokedSessions: revoked });
}

const BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯";

// Search runs on normalized text: lowercase ASCII plus Bengali digits folded to
// ASCII so "২" and "2" find the same product. Punctuation only separates words.
export function normalizeSearchText(value) {
  return String(value)
    .toLowerCase()
    .replace(/[০-৯]/g, (digit) => String(BENGALI_DIGITS.indexOf(digit)))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokenize(value) {
  return normalizeSearchText(value).split(" ").filter(Boolean);
}

// Bounded Levenshtein: returns the edit distance, stopping early when it cannot
// beat `limit`, so fuzzy search stays linear in the query length.
function editDistance(left, right, limit) {
  if (Math.abs(left.length - right.length) > limit) return limit + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let smallest = current[0];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (current[j] < smallest) smallest = current[j];
    }
    if (smallest > limit) return limit + 1;
    previous = current;
  }
  return previous[right.length];
}

const MAX_TYPO_DISTANCE = (token) => (token.length >= 8 ? 2 : token.length >= 5 ? 1 : 0);

function matchToken(queryToken, haystackTokens) {
  let best = 0;
  for (const token of haystackTokens) {
    if (token === queryToken) return 100;
    if (token.startsWith(queryToken)) best = Math.max(best, 70);
    else if (token.includes(queryToken)) best = Math.max(best, 45);
    const limit = MAX_TYPO_DISTANCE(queryToken);
    if (limit > 0 && Math.abs(token.length - queryToken.length) <= limit) {
      const distance = editDistance(queryToken, token, limit);
      if (distance <= limit) best = Math.max(best, 40 - distance * 10);
    }
  }
  return best;
}

// Every query token must match somewhere; the score decides the order. A miss
// on one token drops the product, which keeps "black backpack" precise.
function searchScore(row, categoryLabel, queryTokens) {
  const haystack = tokenize(
    [
      row.name_bn,
      row.name_en,
      row.tagline_bn,
      row.tagline_en,
      row.description_bn,
      row.description_en,
      row.brand ?? "",
      row.slug.replace(/-/g, " "),
      categoryLabel,
    ].join(" "),
  );
  let score = 0;
  for (const token of queryTokens) {
    const tokenScore = matchToken(token, haystack);
    if (tokenScore === 0) return 0;
    score += tokenScore;
  }
  return score;
}

function variantPriceFloor(variants) {
  return variants.reduce(
    (minimum, variant) => Math.min(minimum, variant.price_paisa),
    Number.POSITIVE_INFINITY,
  );
}

function buildFacets(products, variantsByProduct) {
  const brands = new Map();
  const colors = new Map();
  const sizes = new Map();
  const categories = new Map();
  let priceMin = Number.POSITIVE_INFINITY;
  let priceMax = 0;

  for (const product of products) {
    brands.set(product.brand, (brands.get(product.brand) ?? 0) + 1);
    categories.set(product.category_id, (categories.get(product.category_id) ?? 0) + 1);
    priceMin = Math.min(priceMin, product.price_paisa);
    priceMax = Math.max(priceMax, product.price_paisa);
    for (const variant of variantsByProduct.get(product.id) ?? []) {
      const bucket = variant.option_type === "size" ? sizes : colors;
      const key = variant.option_label_en.toLowerCase();
      bucket.set(key, (bucket.get(key) ?? 0) + 1);
    }
  }

  const list = (map) =>
    [...map.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([value, count]) => ({ value, count }));

  return {
    brands: list(brands),
    categories: list(categories),
    colors: list(colors),
    sizes: list(sizes),
    price: {
      minPaisa: Number.isFinite(priceMin) ? priceMin : 0,
      maxPaisa: priceMax,
    },
  };
}

async function loadCatalog(db) {
  const products = rows(
    await db.from("products").select(PRODUCT_COLUMNS).eq("status", "active").limit(200),
  ).filter((row) => row.deleted_at == null);
  const variantRows = rows(
    await db.from("product_variants").select(VARIANT_COLUMNS).limit(500),
  ).sort((left, right) => left.sort_order - right.sort_order);

  const variantsByProduct = new Map();
  for (const variant of variantRows) {
    const bucket = variantsByProduct.get(variant.product_id) ?? [];
    bucket.push(variant);
    variantsByProduct.set(variant.product_id, bucket);
  }
  return { products, variantsByProduct };
}

async function catalogProducts(db, query) {
  const categories = rows(
    await db.from("categories").select("id,name_bn,name_en").limit(50),
  );
  const categoryNames = new Map(
    categories.map((row) => [row.id, `${row.name_bn} ${row.name_en}`]),
  );

  const { products, variantsByProduct } = await loadCatalog(db);
  const queryTokens = tokenize(query.q ?? "");
  const needle = normalizeSearchText(query.q ?? "");
  let list = products;

  if (query.category) list = list.filter((row) => row.category_id === query.category);
  if (query.featured === "true") list = list.filter((row) => row.featured === true);
  if (query.featured === "false") list = list.filter((row) => row.featured !== true);
  if (query.brand) {
    const brand = query.brand.toLowerCase();
    list = list.filter((row) => String(row.brand).toLowerCase() === brand);
  }
  if (query.minPrice !== undefined) {
    list = list.filter((row) => {
      const variants = variantsByProduct.get(row.id) ?? [];
      const floor = variants.length ? variantPriceFloor(variants) : row.price_paisa;
      return Math.min(row.price_paisa, floor) >= query.minPrice;
    });
  }
  if (query.maxPrice !== undefined) {
    list = list.filter((row) => {
      const variants = variantsByProduct.get(row.id) ?? [];
      const floor = variants.length ? variantPriceFloor(variants) : row.price_paisa;
      return Math.min(row.price_paisa, floor) <= query.maxPrice;
    });
  }
  if (query.rating !== undefined) {
    list = list.filter((row) => (row.rating_tenths ?? 0) / 10 >= query.rating);
  }
  if (query.inStock === "true") list = list.filter((row) => row.stock > 0);
  if (query.inStock === "false") list = list.filter((row) => row.stock === 0);
  if (query.option) {
    const option = query.option.toLowerCase();
    list = list.filter((row) =>
      (variantsByProduct.get(row.id) ?? []).some(
        (variant) => variant.option_label_en.toLowerCase() === option,
      ),
    );
  }

  const scored = new Map();
  if (needle) {
    list = list.filter((row) => {
      const score = searchScore(row, categoryNames.get(row.category_id) ?? "", queryTokens);
      if (score > 0) scored.set(row.id, score);
      return score > 0;
    });
  }

  const sort = query.sort ?? "relevance";
  const discount = (row) =>
    row.compare_at_paisa ? (row.compare_at_paisa - row.price_paisa) / row.compare_at_paisa : 0;
  list = [...list];
  if (sort === "price-asc") list.sort((left, right) => left.price_paisa - right.price_paisa);
  else if (sort === "price-desc") list.sort((left, right) => right.price_paisa - left.price_paisa);
  else if (sort === "rating-desc") {
    list.sort(
      (left, right) => right.rating_tenths - left.rating_tenths || right.reviews - left.reviews,
    );
  } else if (sort === "discount-desc") list.sort((left, right) => discount(right) - discount(left));
  else if (sort === "newest") {
    list.sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
  } else if (needle) {
    list.sort(
      (left, right) =>
        scored.get(right.id) - scored.get(left.id) ||
        right.rating_tenths - left.rating_tenths,
    );
  } else {
    list.sort(
      (left, right) =>
        Number(right.featured) - Number(left.featured) || right.rating_tenths - left.rating_tenths,
    );
  }

  const limit = query.limit ?? 60;
  return {
    products: list
      .slice(0, limit)
      .map((row) => publicProduct(row, variantsByProduct.get(row.id) ?? [])),
    total: list.length,
    facets: buildFacets(products, variantsByProduct),
  };
}

async function route(db, request, { origin, setupToken, env }) {
  const path = applicationPath(request);
  const method = request.method;

  // An owner-configured allowlist narrows every staff API to known networks.
  if (path.startsWith("/api/admin/")) {
    await enforceAdminNetwork(db, request);
  }

  if (path === "/api/health" && method === "GET") {
    return json({ ok: true });
  }

  if (path === "/api/setup" && method === "POST") {
    return setup(db, request, { setupToken });
  }

  if (path === "/api/auth/register" && method === "POST") {
    return register(db, request, origin);
  }

  if (path === "/api/auth/login" && method === "POST") {
    return login(db, request, origin);
  }

  if (path === "/api/auth/login/2fa" && method === "POST") {
    return loginTwoFactor(db, request, origin);
  }

  if (path === "/api/auth/2fa/status" && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    return handleTwoFactorStatus(db, principal);
  }

  if (path === "/api/auth/2fa/setup" && method === "POST") {
    const { principal } = await sessionPrincipal(db, request);
    return handleTwoFactorSetup(db, request, principal);
  }

  if (path === "/api/auth/2fa/enable" && method === "POST") {
    const { principal } = await sessionPrincipal(db, request);
    return handleTwoFactorEnable(db, request, principal);
  }

  if (path === "/api/auth/2fa/disable" && method === "POST") {
    const { principal } = await sessionPrincipal(db, request);
    return handleTwoFactorDisable(db, request, principal);
  }

  if (path === "/api/auth/2fa/recovery" && method === "POST") {
    const { principal } = await sessionPrincipal(db, request);
    return handleRecoveryRegenerate(db, request, principal);
  }

  if (path === "/api/auth/password" && method === "POST") {
    const { principal } = await sessionPrincipal(db, request);
    const response = await handlePasswordChange(db, request, principal);
    response.headers.append("set-cookie", clearSessionCookie(secureFor(origin)));
    return response;
  }

  if (path === "/api/auth/logout" && method === "POST") {
    return logout(db, request, origin);
  }

  if (path === "/api/auth/logout-all" && method === "POST") {
    const { principal } = await sessionPrincipal(db, request);
    const revoked = await revokeAllSessions(db, principal.user.id);
    return json({ ok: true, revokedSessions: revoked }, 200, {
      "set-cookie": clearSessionCookie(secureFor(origin)),
    });
  }

  if (path === "/api/auth/me" && method === "GET") {
    const { principal, session } = await sessionPrincipal(db, request);
    return json({
      user: publicPrincipal(principal),
      session: { expiresAt: new Date(session.expiresAt).toISOString() },
    });
  }

  if (path === "/api/catalog/categories" && method === "GET") {
    const categories = rows(
      await db
        .from("categories")
        .select("id,slug,name_bn,name_en,blurb_bn,blurb_en,accent,icon,sort_order")
        .limit(50),
    );
    categories.sort((left, right) => left.sort_order - right.sort_order);
    return json({
      categories: categories.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: { bn: row.name_bn, en: row.name_en },
        blurb: { bn: row.blurb_bn, en: row.blurb_en },
        accent: row.accent,
        icon: row.icon,
      })),
    });
  }

  if (path === "/api/catalog/products" && method === "GET") {
    const query = parse(catalogQuerySchema, Object.fromEntries(new URL(request.url).searchParams));
    if (query.q) {
      const searchLimit = await consume(db, "search", clientIp(request));
      if (!searchLimit.allowed) return rateLimited(searchLimit);
    }
    return json(await catalogProducts(db, query));
  }

  const productMatch = path.match(/^\/api\/catalog\/products\/([a-z0-9-]{1,80})$/);
  if (productMatch && method === "GET") {
    const found = rows(
      await db
        .from("products")
        .select(PRODUCT_COLUMNS)
        .eq("slug", productMatch[1])
        .eq("status", "active")
        .limit(1),
    );
    if (found.length !== 1 || found[0].deleted_at != null) throw new AppError("not_found", 404);
    const variants = rows(
      await db
        .from("product_variants")
        .select(VARIANT_COLUMNS)
        .eq("product_id", found[0].id)
        .limit(50),
    ).sort((left, right) => left.sort_order - right.sort_order);
    return json({ product: publicProduct(found[0], variants) });
  }

  const productReviewsMatch = path.match(
    /^\/api\/catalog\/products\/([a-z0-9-]{1,80})\/reviews$/,
  );
  if (productReviewsMatch && method === "GET") {
    return handleProductReviews(db, productReviewsMatch[1]);
  }

  if (path === "/api/locations/districts" && method === "GET") {
    const districts = rows(
      await db
        .from("districts")
        .select("id,name_bn,name_en,division_bn,division_en,sort_order")
        .limit(100),
    );
    districts.sort((left, right) => left.sort_order - right.sort_order);
    return json({
      districts: districts.map((row) => ({
        id: row.id,
        name: { bn: row.name_bn, en: row.name_en },
        division: { bn: row.division_bn, en: row.division_en },
      })),
    });
  }

  if (path === "/api/checkout/config" && method === "GET") {
    return handleCheckoutConfig(db, env);
  }

  if (path === "/api/coupons/validate" && method === "POST") {
    return handleCouponValidate(db, request);
  }

  if (path === "/api/orders" && method === "POST") {
    return handleCreateOrder(db, request, await optionalUserId(db, request), { origin, env });
  }

  if (path === "/api/payments/session" && method === "POST") {
    return handleCreatePaymentSession(db, request, { origin, env });
  }

  if (path === "/api/payments/verify" && method === "POST") {
    return handlePaymentVerify(db, request, { origin, env });
  }

  const paymentSessionMatch = path.match(
    /^\/api\/payments\/session\/([0-9a-f-]{36})(\/complete)?$/,
  );
  if (paymentSessionMatch) {
    if (!isUuid(paymentSessionMatch[1])) throw new AppError("not_found", 404);
    if (!paymentSessionMatch[2] && method === "GET") {
      return handlePaymentSessionInfo(db, request, paymentSessionMatch[1], env);
    }
    if (paymentSessionMatch[2] === "/complete" && method === "POST") {
      return handleSandboxComplete(db, request, paymentSessionMatch[1], { origin, env });
    }
  }

  const webhookMatch = path.match(/^\/api\/payments\/webhook\/([a-z]+)$/);
  if (webhookMatch && method === "POST") {
    return handlePaymentWebhook(db, webhookMatch[1], request, env);
  }

  if (path === "/api/orders/track" && method === "POST") {
    return handleTrackOrder(db, request);
  }

  const orderMatch = path.match(/^\/api\/orders\/(LP-\d{6}-[0-9A-Z]{6})$/);
  if (orderMatch && method === "GET") {
    return handleOrderLookup(db, request, orderMatch[1], await optionalUserId(db, request));
  }

  if (path === "/api/account/orders" && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    return handleAccountOrders(db, request, principal.user.id);
  }

  if (path === "/api/support/start" && method === "POST") {
    return handleSupportStart(db, request, await optionalUserId(db, request), env);
  }

  if (path === "/api/support/session" && method === "POST") {
    return handleSupportSession(db, request);
  }

  if (path === "/api/support/messages" && method === "POST") {
    return handleSupportMessage(db, request, env);
  }

  if (path === "/api/support/handoff" && method === "POST") {
    return handleSupportHandoff(db, request);
  }

  if (path === "/api/support/faq" && method === "GET") {
    return handleSupportFaq(db, request);
  }

  if (path === "/api/reviews" && method === "POST") {
    return handleReviewCreate(db, request, await optionalUserId(db, request));
  }

  const reviewHelpfulMatch = path.match(/^\/api\/reviews\/([0-9a-f-]{36})\/helpful$/);
  if (reviewHelpfulMatch && method === "POST") {
    if (!isUuid(reviewHelpfulMatch[1])) throw new AppError("not_found", 404);
    return handleReviewHelpful(db, request, reviewHelpfulMatch[1]);
  }

  if (path === "/api/marketing/flash-sale" && method === "GET") {
    return handleFlashSale(db);
  }

  if (path === "/api/marketing/banners" && method === "GET") {
    return handleBanners(db);
  }

  if (path === "/api/marketing/spin" && method === "GET") {
    return handleSpinPublic(db);
  }

  if (path === "/api/marketing/spin" && method === "POST") {
    return handleSpinPlay(db, request);
  }

  if (path === "/api/marketing/back-in-stock" && method === "POST") {
    return handleBackInStockRequest(db, request);
  }

  if (path === "/api/marketing/unsubscribe" && method === "POST") {
    return handleUnsubscribe(db, request);
  }

  if (path === "/api/marketing/cart-reminder" && method === "POST") {
    return handleCartReminder(db, request);
  }

  if (path === "/api/marketing/loyalty" && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    if (principal.user.role_id !== CUSTOMER_ROLE) return json({ error: "not_customer" }, 403);
    return handleLoyalty(db, request, principal.user.id);
  }

  if (path === "/api/marketing/loyalty/redeem" && method === "POST") {
    const { principal } = await sessionPrincipal(db, request);
    if (principal.user.role_id !== CUSTOMER_ROLE) return json({ error: "not_customer" }, 403);
    return handleLoyaltyRedeem(db, request, principal.user.id);
  }

  if (path === "/api/account/profile" && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    return handleAccountMe(db, request, principal.user.id);
  }

  if (path === "/api/account/profile" && method === "PATCH") {
    const { principal } = await sessionPrincipal(db, request);
    return handleAccountProfile(db, request, principal.user.id);
  }

  if (path === "/api/account/data-export" && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    return handleAccountDataExport(db, principal);
  }

  if (path === "/api/account/delete" && method === "POST") {
    const { principal } = await sessionPrincipal(db, request);
    const response = await handleAccountDelete(db, request, principal);
    response.headers.append("set-cookie", clearSessionCookie(secureFor(origin)));
    return response;
  }

  if (path === "/api/admin/dashboard" && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "orders.read");
    return handleAdminDashboard(db);
  }

  if (path === "/api/admin/orders" && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "orders.read");
    return handleAdminOrders(db, request);
  }

  const adminOrderMatch = path.match(
    /^\/api\/admin\/orders\/(LP-\d{6}-[0-9A-Z]{6})(\/status|\/payment|\/courier)?$/,
  );
  if (adminOrderMatch) {
    const { principal } = await sessionPrincipal(db, request);
    const orderNumber = adminOrderMatch[1];
    const action = adminOrderMatch[2];
    if (!action && method === "GET") {
      requirePermission(principal, "orders.read");
      return handleAdminOrderDetail(db, orderNumber, env);
    }
    if (action === "/status" && method === "PATCH") {
      requirePermission(principal, "orders.write");
      return handleAdminOrderStatus(db, request, principal, orderNumber, { origin, env });
    }
    if (action === "/payment" && method === "PATCH") {
      requirePermission(principal, "payments.manage");
      requireOwner(principal);
      return handleAdminPaymentStatus(db, request, principal, orderNumber);
    }
    if (action === "/courier" && method === "PATCH") {
      requirePermission(principal, "orders.write");
      return handleAssignCourier(db, request, principal, orderNumber, env);
    }
  }

  if (path === "/api/admin/products" && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "products.read");
    return handleAdminProducts(db, request);
  }

  if (path === "/api/admin/products" && method === "POST") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "products.write");
    return handleProductCreate(db, request, principal);
  }

  if (path === "/api/admin/products/import" && method === "POST") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "products.write");
    return handleProductImport(db, request, principal);
  }

  const adminProductMatch = path.match(
    /^\/api\/admin\/products\/([0-9a-f-]{36})(\/archive)?$/,
  );
  if (adminProductMatch) {
    const { principal } = await sessionPrincipal(db, request);
    if (!isUuid(adminProductMatch[1])) throw new AppError("not_found", 404);
    const productId = adminProductMatch[1];
    if (!adminProductMatch[2] && method === "GET") {
      requirePermission(principal, "products.read");
      return handleAdminProductDetail(db, productId);
    }
    if (!adminProductMatch[2] && method === "PATCH") {
      requirePermission(principal, "products.write");
      return handleProductUpdate(db, request, principal, productId, env);
    }
    if (adminProductMatch[2] === "/archive" && method === "POST") {
      requirePermission(principal, "data.delete");
      requireOwner(principal);
      return handleProductArchive(db, request, principal, productId);
    }
  }

  if (path === "/api/admin/audit" && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "audit.read");
    requireOwner(principal);
    return handleAdminAudit(db, request);
  }

  if (path === "/api/admin/audit/export" && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "audit.read");
    requireOwner(principal);
    return handleAdminAuditExport(db, request);
  }

  if (path === "/api/admin/backups" && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    return handleBackupList(db, principal);
  }

  if (path === "/api/admin/backups" && method === "POST") {
    const { principal } = await sessionPrincipal(db, request);
    return handleBackupCreate(db, request, principal);
  }

  const backupMatch = path.match(/^\/api\/admin\/backups\/([0-9a-f-]{36})$/);
  if (backupMatch && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    if (!isUuid(backupMatch[1])) throw new AppError("not_found", 404);
    return handleBackupDownload(db, principal, backupMatch[1]);
  }

  if (path === "/api/admin/team" && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "team.read");
    return json({ team: await listTeam(db) });
  }

  if (path === "/api/admin/team" && method === "POST") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "team.write");
    requireOwner(principal);
    return createTeamMember(db, request);
  }

  const teamMatch = path.match(
    /^\/api\/admin\/team\/([0-9a-f-]{36})(\/revoke-sessions|\/password|\/2fa-reset)?$/,
  );
  if (teamMatch) {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "team.write");
    requireOwner(principal);
    if (!isUuid(teamMatch[1])) throw new AppError("not_found", 404);
    if (teamMatch[2] === "/revoke-sessions" && method === "POST") {
      const target = await findUserById(db, teamMatch[1]);
      if (!target || target.deleted_at != null) throw new AppError("not_found", 404);
      if (target.role_id === OWNER_ROLE) throw new AppError("cannot_modify_owner", 409);
      const revoked = await revokeAllSessions(db, teamMatch[1]);
      return json({ ok: true, revokedSessions: revoked });
    }
    if (teamMatch[2] === "/password" && method === "POST") {
      return handleTeamPasswordReset(db, request, principal, teamMatch[1]);
    }
    if (teamMatch[2] === "/2fa-reset" && method === "POST") {
      return handleTeamTwoFactorReset(db, request, principal, teamMatch[1]);
    }
    if (!teamMatch[2] && method === "PATCH") {
      return updateTeamMember(db, teamMatch[1], request, principal);
    }
  }

  if (path === "/api/admin/settings" && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "settings.read");
    return handleAdminSettings(db, env);
  }

  if (path === "/api/admin/settings" && method === "PATCH") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "settings.write");
    return handleAdminSettingsUpdate(db, request, principal, env);
  }

  if (path === "/api/admin/support" && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "support.read");
    return handleAdminSupportInbox(db, request);
  }

  if (path === "/api/admin/support/canned" && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "support.read");
    return handleAdminCannedList(db);
  }

  if (path === "/api/admin/support/canned" && method === "POST") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "support.write");
    return handleAdminCannedCreate(db, request, principal);
  }

  const adminSupportMatch = path.match(
    /^\/api\/admin\/support\/([0-9a-f-]{36})(\/reply|\/assign|\/close)?$/,
  );
  if (adminSupportMatch) {
    const { principal } = await sessionPrincipal(db, request);
    if (!isUuid(adminSupportMatch[1])) throw new AppError("not_found", 404);
    const conversationId = adminSupportMatch[1];
    const action = adminSupportMatch[2];
    if (!action && method === "GET") {
      requirePermission(principal, "support.read");
      return handleAdminSupportDetail(db, conversationId);
    }
    if (action === "/reply" && method === "POST") {
      requirePermission(principal, "support.write");
      return handleAdminSupportReply(db, request, principal, conversationId);
    }
    if (action === "/assign" && method === "POST") {
      requirePermission(principal, "support.write");
      return handleAdminSupportAssign(db, request, principal, conversationId);
    }
    if (action === "/close" && method === "POST") {
      requirePermission(principal, "support.write");
      return handleAdminSupportClose(db, request, principal, conversationId);
    }
  }

  if (path === "/api/admin/coupons" && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "marketing.read");
    return handleAdminCoupons(db);
  }

  if (path === "/api/admin/coupons" && method === "POST") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "marketing.write");
    return handleAdminCouponCreate(db, request, principal);
  }

  const adminCouponMatch = path.match(/^\/api\/admin\/coupons\/([A-Za-z0-9_-]{1,40})$/);
  if (adminCouponMatch && method === "PATCH") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "marketing.write");
    return handleAdminCouponUpdate(db, request, principal, adminCouponMatch[1]);
  }

  if (path === "/api/admin/flash-sales" && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "marketing.read");
    return handleAdminFlashSales(db);
  }

  if (path === "/api/admin/flash-sales" && method === "POST") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "marketing.write");
    return handleAdminFlashSaleCreate(db, request, principal);
  }

  const adminFlashSaleMatch = path.match(/^\/api\/admin\/flash-sales\/([A-Za-z0-9_-]{1,60})$/);
  if (adminFlashSaleMatch && method === "PATCH") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "marketing.write");
    return handleAdminFlashSaleUpdate(db, request, principal, adminFlashSaleMatch[1]);
  }

  if (path === "/api/admin/spin" && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "marketing.read");
    return handleAdminSpin(db);
  }

  if (path === "/api/admin/spin" && method === "PATCH") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "marketing.write");
    return handleAdminSpinUpdate(db, request, principal);
  }

  if (path === "/api/admin/campaigns" && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "marketing.read");
    return handleAdminCampaigns(db);
  }

  if (path === "/api/admin/campaigns" && method === "POST") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "marketing.write");
    return handleAdminCampaignCreate(db, request, principal, env);
  }

  if (path === "/api/admin/reviews" && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "reviews.read");
    return handleAdminReviews(db, request);
  }

  const adminReviewMatch = path.match(/^\/api\/admin\/reviews\/([0-9a-f-]{36})$/);
  if (adminReviewMatch && method === "PATCH") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "reviews.write");
    return handleAdminReviewUpdate(db, request, principal, adminReviewMatch[1]);
  }

  if (path === "/api/admin/customers" && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "customers.read");
    return handleAdminCustomers(db, request);
  }

  const adminCustomerExportMatch = path.match(
    /^\/api\/admin\/customers\/([^/]{3,24})\/export$/,
  );
  if (adminCustomerExportMatch && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    let phone;
    try {
      phone = decodeURIComponent(adminCustomerExportMatch[1]);
    } catch {
      throw new AppError("not_found", 404);
    }
    if (!/^\+?[0-9]{6,18}$/.test(phone)) throw new AppError("not_found", 404);
    return handleAdminCustomerExport(db, request, principal, phone);
  }

  const adminCustomerMatch = path.match(/^\/api\/admin\/customers\/([^/]{3,24})$/);
  if (adminCustomerMatch) {
    const { principal } = await sessionPrincipal(db, request);
    let phone;
    try {
      phone = decodeURIComponent(adminCustomerMatch[1]);
    } catch {
      throw new AppError("not_found", 404);
    }
    if (!/^\+?[0-9]{6,18}$/.test(phone)) throw new AppError("not_found", 404);
    if (method === "GET") {
      requirePermission(principal, "customers.read");
      return handleAdminCustomerDetail(db, phone);
    }
    if (method === "PATCH") {
      requirePermission(principal, "customers.write");
      return handleAdminCustomerUpdate(db, request, principal, phone);
    }
  }

  if (path === "/api/admin/banners" && method === "GET") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "marketing.read");
    return handleAdminBanners(db);
  }

  if (path === "/api/admin/banners" && method === "POST") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "marketing.write");
    return handleAdminBannerCreate(db, request, principal);
  }

  const adminBannerMatch = path.match(/^\/api\/admin\/banners\/([A-Za-z0-9_-]{1,60})$/);
  if (adminBannerMatch && method === "PATCH") {
    const { principal } = await sessionPrincipal(db, request);
    requirePermission(principal, "marketing.write");
    return handleAdminBannerUpdate(db, request, principal, adminBannerMatch[1]);
  }

  const known = [
    "/api/health",
    "/api/setup",
    "/api/auth/register",
    "/api/auth/login",
    "/api/auth/login/2fa",
    "/api/auth/2fa/status",
    "/api/auth/2fa/setup",
    "/api/auth/2fa/enable",
    "/api/auth/2fa/disable",
    "/api/auth/2fa/recovery",
    "/api/auth/password",
    "/api/auth/logout",
    "/api/auth/logout-all",
    "/api/auth/me",
    "/api/catalog/categories",
    "/api/catalog/products",
    "/api/locations/districts",
    "/api/checkout/config",
    "/api/coupons/validate",
    "/api/orders",
    "/api/orders/track",
    "/api/account/orders",
    "/api/payments/session",
    "/api/payments/verify",
    "/api/admin/team",
    "/api/admin/settings",
    "/api/admin/support",
    "/api/admin/support/canned",
    "/api/admin/dashboard",
    "/api/admin/orders",
    "/api/admin/products",
    "/api/admin/products/import",
    "/api/admin/audit",
    "/api/admin/audit/export",
    "/api/admin/backups",
    "/api/support/start",
    "/api/support/session",
    "/api/support/messages",
    "/api/support/handoff",
    "/api/support/faq",
    "/api/reviews",
    "/api/marketing/flash-sale",
    "/api/marketing/banners",
    "/api/marketing/spin",
    "/api/marketing/back-in-stock",
    "/api/marketing/unsubscribe",
    "/api/marketing/cart-reminder",
    "/api/marketing/loyalty",
    "/api/marketing/loyalty/redeem",
    "/api/account/profile",
    "/api/account/data-export",
    "/api/account/delete",
    "/api/admin/coupons",
    "/api/admin/flash-sales",
    "/api/admin/spin",
    "/api/admin/campaigns",
    "/api/admin/reviews",
    "/api/admin/customers",
    "/api/admin/banners",
  ];
  if (
    known.includes(path) ||
    teamMatch ||
    productMatch ||
    orderMatch ||
    adminOrderMatch ||
    adminProductMatch ||
    adminSupportMatch ||
    paymentSessionMatch ||
    webhookMatch ||
    productReviewsMatch ||
    reviewHelpfulMatch ||
    adminCouponMatch ||
    adminFlashSaleMatch ||
    adminReviewMatch ||
    adminCustomerMatch ||
    adminCustomerExportMatch ||
    adminBannerMatch ||
    backupMatch
  ) {
    throw new AppError("method_not_allowed", 405);
  }
  throw new AppError("not_found", 404);
}

export function createApplication({ db, origin, setupToken, env }) {
  const resolveOrigin = typeof origin === "function" ? origin : () => origin;
  const resolveSetupToken = typeof setupToken === "function" ? setupToken : () => setupToken;
  const resolveEnv = typeof env === "function" ? env : () => env ?? {};

  return async function handle(request) {
    const siteOrigin = resolveOrigin(request);
    try {
      // Provider webhooks carry no browser Origin; their HMAC signature is the
      // authentication, so the same-origin CSRF check does not apply.
      if (!applicationPath(request).startsWith("/api/payments/webhook/")) {
        requireTrustedOrigin(request, siteOrigin);
      }
      return await route(db, request, {
        origin: siteOrigin,
        setupToken: resolveSetupToken(),
        env: resolveEnv(),
      });
    } catch (error) {
      if (error instanceof SessionRequired) return unauthorized(error.state, siteOrigin);
      if (error instanceof AppError) return errorJson(error.code, error.status);
      return errorJson("service_unavailable", 503);
    }
  };
}
