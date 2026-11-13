// Step 9 security services: TOTP enrolment, recovery codes, second-factor login
// challenges, password rotation, the optional /admin IP allowlist, owner
// backups and customer data export/deletion. Every mutation is audited.
import { AppError, clientIp, json, readJson, rows, secureCompare } from "./http.mjs";
import { hashPassword, verifyPassword } from "./passwords.mjs";
import {
  newSessionToken,
  revokeAllSessions,
  sha256Hex,
} from "./sessions.mjs";
import { requireOwner, requirePermission } from "./rbac.mjs";
import { recordAudit } from "./audit.mjs";
import { consume } from "./limiter.mjs";
import {
  generateRecoveryCodes,
  newTotpSecret,
  otpauthUri,
  recoveryCodeDigest,
  verifyTotp,
} from "./totp.mjs";
import {
  accountDeleteSchema,
  parse,
  passwordChangeSchema,
  teamPasswordResetSchema,
  twoFactorEnableSchema,
  twoFactorSetupSchema,
  twoFactorVerifySchema,
} from "./validate.mjs";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CHALLENGE_ATTEMPTS = 5;
const BACKUP_LIMIT = 20;
const BACKUP_TABLE_LIMIT = 5000;

const SECURITY_USER_COLUMNS =
  "id,name,email,phone,role_id,status,password_salt,password_hash,password_iterations,two_factor_secret,two_factor_enabled_at,birth_date,marketing_opt_out,created_at,deleted_at";

const BACKUP_TABLES = [
  "roles",
  "permissions",
  "role_permissions",
  "users",
  "user_recovery_codes",
  "categories",
  "districts",
  "products",
  "product_images",
  "product_variants",
  "settings",
  "coupons",
  "orders",
  "order_items",
  "order_status_history",
  "payments",
  "coupon_redemptions",
  "audit_logs",
  "support_conversations",
  "support_messages",
  "support_canned_replies",
  "faq_entries",
  "reviews",
  "review_votes",
  "flash_sales",
  "flash_sale_items",
  "spin_prizes",
  "spin_results",
  "loyalty_ledger",
  "customer_blocks",
  "customer_notes",
  "back_in_stock_alerts",
  "campaigns",
  "banners",
  "cart_reminders",
  "marketing_suppressions",
  "payment_sessions",
  "webhook_events",
  "sms_log",
];

const nowIso = () => new Date().toISOString();

function rateLimited(result) {
  return json({ error: "rate_limited" }, 429, {
    "retry-after": String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))),
  });
}

async function limit(db, scope, subject) {
  const result = await consume(db, scope, subject);
  return result.allowed ? null : rateLimited(result);
}

async function loadSecurityUser(db, userId) {
  const found = rows(
    await db.from("users").select(SECURITY_USER_COLUMNS).eq("id", userId).limit(1),
  );
  if (found.length !== 1 || found[0].deleted_at != null) throw new AppError("login_required", 401);
  return found[0];
}

async function verifyPasswordOrThrow(user, password) {
  const ok = await verifyPassword(password, {
    salt: user.password_salt,
    hash: user.password_hash,
    iterations: user.password_iterations,
  });
  if (!ok) throw new AppError("invalid_credentials", 401);
}

async function invalidateRecoveryCodes(db, userId) {
  const codes = rows(
    await db
      .from("user_recovery_codes")
      .select("id,used_at")
      .eq("user_id", userId)
      .limit(100),
  );
  let invalidated = 0;
  for (const row of codes) {
    if (row.used_at != null) continue;
    await db
      .from("user_recovery_codes")
      .update({ used_at: nowIso() })
      .eq("id", row.id)
      .select("id");
    invalidated += 1;
  }
  return invalidated;
}

async function issueRecoveryCodes(db, userId) {
  await invalidateRecoveryCodes(db, userId);
  const codes = await generateRecoveryCodes(10);
  const createdAt = nowIso();
  for (const entry of codes) {
    const saved = rows(
      await db
        .from("user_recovery_codes")
        .insertIfAbsent(
          {
            id: crypto.randomUUID(),
            user_id: userId,
            code_digest: entry.digest,
            created_at: createdAt,
            used_at: null,
          },
          { onConflict: "user_id,code_digest" },
        )
        .select("id"),
    );
    if (saved.length !== 1) throw new AppError("recovery_code_unavailable", 503);
  }
  return codes.map((entry) => entry.code);
}

// ---------------------------------------------------------------------------
// /admin IP allowlist. An empty list keeps the current open-staff behaviour.

function ipv4ToInt(value) {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  let total = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    total = total * 256 + octet;
  }
  return total;
}

export function ipAllowed(ip, raw) {
  if (typeof raw !== "string" || raw.trim() === "") return true;
  const entries = raw.split(/[,\s]+/).map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) return true;
  const target = String(ip ?? "");
  for (const entry of entries) {
    if (entry === target) return true;
    if (!entry.includes("/")) continue;
    const [base, bitsText] = entry.split("/");
    const bits = Number(bitsText);
    const baseInt = ipv4ToInt(base);
    const targetInt = ipv4ToInt(target);
    if (baseInt === null || targetInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
      continue;
    }
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((baseInt & mask) === (targetInt & mask)) return true;
  }
  return false;
}

export async function enforceAdminNetwork(db, request) {
  const stored = rows(
    await db
      .from("settings")
      .select("key,value")
      .eq("key", "security.admin_ip_allowlist")
      .limit(1),
  );
  const raw = stored[0]?.value ?? "";
  if (typeof raw !== "string" || raw.trim() === "") return;
  if (!ipAllowed(clientIp(request), raw)) throw new AppError("admin_ip_forbidden", 403);
}

// ---------------------------------------------------------------------------
// Second-factor login challenges.

export async function createLoginChallenge(db, request, userId) {
  const token = newSessionToken();
  const digest = await sha256Hex(token);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  const inserted = rows(
    await db
      .from("login_challenges")
      .insertIfAbsent(
        {
          token_digest: digest,
          user_id: userId,
          ip: clientIp(request),
          created_at: createdAt,
          expires_at: expiresAt,
          attempts: 0,
          consumed_at: null,
        },
        { onConflict: "token_digest" },
      )
      .select("token_digest"),
  );
  if (inserted.length !== 1) throw new AppError("challenge_unavailable", 503);
  return { challengeToken: token, digest, expiresAt };
}

export async function readLoginChallenge(db, token) {
  const digest = await sha256Hex(token);
  const found = rows(
    await db
      .from("login_challenges")
      .select("token_digest,user_id,expires_at,attempts,consumed_at")
      .eq("token_digest", digest)
      .limit(1),
  );
  if (found.length !== 1) return null;
  const row = found[0];
  if (row.consumed_at != null) return null;
  const expiresAt = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  if (!Number.isSafeInteger(row.attempts) || row.attempts >= MAX_CHALLENGE_ATTEMPTS) return null;
  return { digest, userId: row.user_id, attempts: row.attempts };
}

export async function recordChallengeFailure(db, digest, attempts) {
  await db
    .from("login_challenges")
    .update({ attempts: attempts + 1 })
    .eq("token_digest", digest)
    .select("token_digest");
}

export async function consumeLoginChallenge(db, digest) {
  const updated = rows(
    await db
      .from("login_challenges")
      .update({ consumed_at: nowIso() })
      .eq("token_digest", digest)
      .select("token_digest"),
  );
  return updated.length === 1;
}

// TOTP first, then a single-use recovery code. The comparison runs over digests
// with a constant-time helper so a database timing side channel is not exposed.
export async function verifySecondFactor(db, user, { code, recoveryCode }) {
  if (code) {
    return verifyTotp(user.two_factor_secret, code);
  }
  if (!recoveryCode) return false;
  const digest = await recoveryCodeDigest(recoveryCode);
  const codes = rows(
    await db
      .from("user_recovery_codes")
      .select("id,code_digest,used_at")
      .eq("user_id", user.id)
      .limit(100),
  );
  for (const row of codes) {
    if (row.used_at != null) continue;
    if (!(await secureCompare(String(row.code_digest), digest))) continue;
    const marked = rows(
      await db
        .from("user_recovery_codes")
        .update({ used_at: nowIso() })
        .eq("id", row.id)
        .select("id"),
    );
    return marked.length === 1;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Self-service security endpoints.

export async function handleTwoFactorStatus(db, principal) {
  const user = await loadSecurityUser(db, principal.user.id);
  const enabled = user.two_factor_enabled_at != null;
  const pending = typeof user.two_factor_secret === "string" && user.two_factor_secret.length > 0 && !enabled;
  let recoveryCodesRemaining = 0;
  if (enabled) {
    const codes = rows(
      await db
        .from("user_recovery_codes")
        .select("id,used_at")
        .eq("user_id", user.id)
        .limit(100),
    );
    recoveryCodesRemaining = codes.filter((row) => row.used_at == null).length;
  }
  return json({
    enabled,
    pending,
    required: Boolean(principal.twoFactorRequired),
    setupRequired: Boolean(principal.twoFactorSetupRequired),
    recoveryCodesRemaining,
  });
}

export async function handleTwoFactorSetup(db, request, principal) {
  const limited = await limit(db, "two_factor_setup", principal.user.id);
  if (limited) return limited;
  const body = parse(twoFactorSetupSchema, await readJson(request));
  const user = await loadSecurityUser(db, principal.user.id);
  if (user.two_factor_enabled_at != null) throw new AppError("two_factor_already_enabled", 409);
  await verifyPasswordOrThrow(user, body.password);

  const secret = newTotpSecret();
  const updated = rows(
    await db
      .from("users")
      .update({ two_factor_secret: secret, two_factor_enabled_at: null, updated_at: nowIso() })
      .eq("id", user.id)
      .select("id"),
  );
  if (updated.length !== 1) throw new AppError("update_unconfirmed", 503);

  await recordAudit(db, request, principal, {
    action: "auth.2fa_setup",
    entityType: "user",
    entityId: user.id,
    summary: "Two-factor enrolment started",
    details: {},
  });

  const account = user.email ?? user.phone ?? user.id;
  return json({
    secret,
    otpauthUri: otpauthUri({ secret, account }),
    digits: 6,
    period: 30,
  });
}

export async function handleTwoFactorEnable(db, request, principal) {
  const body = parse(twoFactorEnableSchema, await readJson(request));
  const user = await loadSecurityUser(db, principal.user.id);
  if (user.two_factor_enabled_at != null) throw new AppError("two_factor_already_enabled", 409);
  if (!user.two_factor_secret) throw new AppError("two_factor_setup_required", 409);
  if (!(await verifyTotp(user.two_factor_secret, body.code))) {
    throw new AppError("invalid_code", 400);
  }

  const updated = rows(
    await db
      .from("users")
      .update({ two_factor_enabled_at: nowIso(), updated_at: nowIso() })
      .eq("id", user.id)
      .select("id"),
  );
  if (updated.length !== 1) throw new AppError("update_unconfirmed", 503);
  const recoveryCodes = await issueRecoveryCodes(db, user.id);

  await recordAudit(db, request, principal, {
    action: "auth.2fa_enabled",
    entityType: "user",
    entityId: user.id,
    summary: "Two-factor authentication enabled",
    details: { recoveryCodes: recoveryCodes.length },
  });

  return json({ ok: true, enabled: true, recoveryCodes });
}

export async function handleTwoFactorDisable(db, request, principal) {
  if (principal.twoFactorRequired) throw new AppError("two_factor_required_for_role", 409);
  const body = parse(twoFactorVerifySchema, await readJson(request));
  const user = await loadSecurityUser(db, principal.user.id);
  if (user.two_factor_enabled_at == null || !user.two_factor_secret) {
    throw new AppError("two_factor_not_enabled", 409);
  }
  await verifyPasswordOrThrow(user, body.password);
  if (!(await verifyTotp(user.two_factor_secret, body.code))) {
    throw new AppError("invalid_code", 400);
  }

  const updated = rows(
    await db
      .from("users")
      .update({
        two_factor_secret: null,
        two_factor_enabled_at: null,
        updated_at: nowIso(),
      })
      .eq("id", user.id)
      .select("id"),
  );
  if (updated.length !== 1) throw new AppError("update_unconfirmed", 503);
  await invalidateRecoveryCodes(db, user.id);

  await recordAudit(db, request, principal, {
    action: "auth.2fa_disabled",
    entityType: "user",
    entityId: user.id,
    summary: "Two-factor authentication disabled",
    details: {},
  });
  return json({ ok: true, enabled: false });
}

export async function handleRecoveryRegenerate(db, request, principal) {
  const limited = await limit(db, "two_factor_setup", principal.user.id);
  if (limited) return limited;
  const body = parse(twoFactorVerifySchema, await readJson(request));
  const user = await loadSecurityUser(db, principal.user.id);
  if (user.two_factor_enabled_at == null || !user.two_factor_secret) {
    throw new AppError("two_factor_not_enabled", 409);
  }
  await verifyPasswordOrThrow(user, body.password);
  if (!(await verifyTotp(user.two_factor_secret, body.code))) {
    throw new AppError("invalid_code", 400);
  }

  const recoveryCodes = await issueRecoveryCodes(db, user.id);
  await recordAudit(db, request, principal, {
    action: "auth.recovery_codes",
    entityType: "user",
    entityId: user.id,
    summary: "Recovery codes regenerated",
    details: { recoveryCodes: recoveryCodes.length },
  });
  return json({ ok: true, recoveryCodes });
}

export async function handlePasswordChange(db, request, principal) {
  const limited = await limit(db, "password_change", principal.user.id);
  if (limited) return limited;
  const body = parse(passwordChangeSchema, await readJson(request));
  const user = await loadSecurityUser(db, principal.user.id);
  await verifyPasswordOrThrow(user, body.currentPassword);

  const derived = await hashPassword(body.newPassword);
  const updated = rows(
    await db
      .from("users")
      .update({
        password_salt: derived.salt,
        password_hash: derived.hash,
        password_iterations: derived.iterations,
        updated_at: nowIso(),
      })
      .eq("id", user.id)
      .select("id"),
  );
  if (updated.length !== 1) throw new AppError("update_unconfirmed", 503);
  const revokedSessions = await revokeAllSessions(db, user.id);

  await recordAudit(db, request, principal, {
    action: "auth.password_changed",
    entityType: "user",
    entityId: user.id,
    summary: "Password changed; sessions revoked",
    details: { revokedSessions },
  });
  return json({ ok: true, revokedSessions });
}

// ---------------------------------------------------------------------------
// Owner-side team recovery.

async function loadTeamTarget(db, teamId, principal) {
  if (teamId === principal.user.id) throw new AppError("cannot_modify_self", 409);
  const found = rows(await db.from("users").select(SECURITY_USER_COLUMNS).eq("id", teamId).limit(1));
  if (found.length !== 1 || found[0].deleted_at != null) throw new AppError("not_found", 404);
  if (found[0].role_id === "owner") throw new AppError("cannot_modify_owner", 409);
  return found[0];
}

export async function handleTeamPasswordReset(db, request, principal, teamId) {
  requirePermission(principal, "team.write");
  requireOwner(principal);
  const target = await loadTeamTarget(db, teamId, principal);
  const body = parse(teamPasswordResetSchema, await readJson(request));
  const derived = await hashPassword(body.password);
  const updated = rows(
    await db
      .from("users")
      .update({
        password_salt: derived.salt,
        password_hash: derived.hash,
        password_iterations: derived.iterations,
        updated_at: nowIso(),
      })
      .eq("id", target.id)
      .select("id"),
  );
  if (updated.length !== 1) throw new AppError("update_unconfirmed", 503);
  const revokedSessions = await revokeAllSessions(db, target.id);
  await recordAudit(db, request, principal, {
    action: "team.password_reset",
    entityType: "user",
    entityId: target.id,
    summary: `Password reset for ${target.name}`,
    details: { revokedSessions },
  });
  return json({ ok: true, revokedSessions });
}

export async function handleTeamTwoFactorReset(db, request, principal, teamId) {
  requirePermission(principal, "team.write");
  requireOwner(principal);
  const target = await loadTeamTarget(db, teamId, principal);
  const updated = rows(
    await db
      .from("users")
      .update({
        two_factor_secret: null,
        two_factor_enabled_at: null,
        updated_at: nowIso(),
      })
      .eq("id", target.id)
      .select("id"),
  );
  if (updated.length !== 1) throw new AppError("update_unconfirmed", 503);
  await invalidateRecoveryCodes(db, target.id);
  const revokedSessions = await revokeAllSessions(db, target.id);
  await recordAudit(db, request, principal, {
    action: "team.2fa_reset",
    entityType: "user",
    entityId: target.id,
    summary: `Two-factor reset for ${target.name}`,
    details: { revokedSessions },
  });
  return json({ ok: true, revokedSessions });
}

// ---------------------------------------------------------------------------
// Owner backups.

function backupMetadata(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    createdBy: row.created_by ?? null,
    tableCount: row.table_count,
    rowCount: row.row_count,
    sizeBytes: row.size_bytes,
    downloadUrl: `/api/admin/backups/${row.id}`,
  };
}

export async function handleBackupCreate(db, request, principal) {
  requirePermission(principal, "data.export");
  requireOwner(principal);
  const limited = await limit(db, "backup_create", principal.user.id);
  if (limited) return limited;

  const tables = {};
  let rowCount = 0;
  for (const table of BACKUP_TABLES) {
    const data = rows(await db.from(table).select("*").limit(BACKUP_TABLE_LIMIT));
    tables[table] = data;
    rowCount += data.length;
  }
  const payload = JSON.stringify({
    version: 1,
    generatedAt: nowIso(),
    generatedBy: { id: principal.user.id, name: principal.user.name },
    tables,
  });
  const bytes = new TextEncoder().encode(payload).length;
  if (bytes > 8 * 1024 * 1024) throw new AppError("backup_too_large", 413);

  const row = {
    id: crypto.randomUUID(),
    created_by: principal.user.id,
    created_at: nowIso(),
    table_count: BACKUP_TABLES.length,
    row_count: rowCount,
    size_bytes: bytes,
    payload,
  };
  const saved = rows(
    await db.from("backups").insertIfAbsent(row, { onConflict: "id" }).select("*"),
  );
  if (saved.length !== 1) throw new AppError("backup_unavailable", 503);

  await recordAudit(db, request, principal, {
    action: "backup.create",
    entityType: "backup",
    entityId: row.id,
    summary: `Backup created (${rowCount} rows)`,
    details: { tables: BACKUP_TABLES.length, sizeBytes: bytes },
  });
  return json({ backup: backupMetadata(row) }, 201);
}

export async function handleBackupList(db, principal) {
  requirePermission(principal, "data.export");
  requireOwner(principal);
  const found = rows(
    await db
      .from("backups")
      .select("id,created_by,created_at,table_count,row_count,size_bytes")
      .limit(100),
  );
  const backups = found
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
    .slice(0, BACKUP_LIMIT)
    .map(backupMetadata);
  return json({ backups });
}

export async function handleBackupDownload(db, principal, backupId) {
  requirePermission(principal, "data.export");
  requireOwner(principal);
  const found = rows(
    await db
      .from("backups")
      .select("id,payload,created_at")
      .eq("id", backupId)
      .limit(1),
  );
  if (found.length !== 1) throw new AppError("not_found", 404);
  return new Response(found[0].payload, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="lootpat-backup-${found[0].id}.json"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

// ---------------------------------------------------------------------------
// Customer privacy: self-service export and anonymising deletion.

function mergeById(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const row of list) {
      if (row?.id) byId.set(row.id, row);
    }
  }
  return [...byId.values()];
}

async function collectCustomerData(db, user) {
  const userId = user.id;
  const phone = user.phone ?? null;
  const orders = phone
    ? mergeById(
        rows(await db.from("orders").select("*").eq("user_id", userId).limit(500)),
        rows(await db.from("orders").select("*").eq("phone", phone).limit(500)),
      )
    : rows(await db.from("orders").select("*").eq("user_id", userId).limit(500));

  const orderItems = [];
  for (const order of orders.slice(0, 100)) {
    const items = rows(
      await db.from("order_items").select("*").eq("order_id", order.id).limit(100),
    );
    orderItems.push(...items.map((item) => ({ ...item, order_number: order.order_number })));
  }

  const reviews = phone
    ? mergeById(
        rows(await db.from("reviews").select("*").eq("user_id", userId).limit(200)),
        rows(await db.from("reviews").select("*").eq("phone", phone).limit(200)),
      )
    : rows(await db.from("reviews").select("*").eq("user_id", userId).limit(200));

  const loyalty = phone
    ? mergeById(
        rows(await db.from("loyalty_ledger").select("*").eq("user_id", userId).limit(500)),
        rows(await db.from("loyalty_ledger").select("*").eq("phone", phone).limit(500)),
      )
    : rows(await db.from("loyalty_ledger").select("*").eq("user_id", userId).limit(500));

  const conversations = phone
    ? mergeById(
        rows(await db.from("support_conversations").select("*").eq("user_id", userId).limit(100)),
        rows(await db.from("support_conversations").select("*").eq("customer_phone", phone).limit(100)),
      )
    : rows(await db.from("support_conversations").select("*").eq("user_id", userId).limit(100));

  const supportMessages = [];
  for (const conversation of conversations) {
    const messages = rows(
      await db
        .from("support_messages")
        .select("id,conversation_id,author_type,body,created_at")
        .eq("conversation_id", conversation.id)
        .limit(500),
    );
    supportMessages.push(...messages);
  }

  const notes = phone
    ? rows(await db.from("customer_notes").select("*").eq("phone", phone).limit(100))
    : [];
  const block = phone
    ? rows(await db.from("customer_blocks").select("*").eq("phone", phone).limit(1))
    : [];

  return {
    profile: {
      id: user.id,
      name: user.name,
      email: user.email ?? null,
      phone: user.phone ?? null,
      status: user.status,
      twoFactorEnabled: user.two_factor_enabled_at != null,
      createdAt: user.created_at,
    },
    orders: orders.map((order) => ({
      orderNumber: order.order_number,
      status: order.status,
      paymentMethod: order.payment_method,
      paymentStatus: order.payment_status,
      totalPaisa: order.total_paisa,
      district: { bn: order.district_name_bn, en: order.district_name_en },
      address: order.address,
      area: order.area ?? null,
      createdAt: order.created_at,
    })),
    orderItems,
    reviews,
    loyalty,
    support: { conversations, messages: supportMessages },
    customerNotes: notes,
    customerBlock: block,
  };
}

export async function handleAccountDataExport(db, principal) {
  const user = await loadSecurityUser(db, principal.user.id);
  const data = await collectCustomerData(db, user);
  return json({ exportedAt: nowIso(), ...data });
}

export async function handleAccountDelete(db, request, principal) {
  if (principal.role.is_staff) throw new AppError("staff_account_delete_blocked", 409);
  const limited = await limit(db, "account_delete", principal.user.id);
  if (limited) return limited;
  const body = parse(accountDeleteSchema, await readJson(request));
  const user = await loadSecurityUser(db, principal.user.id);
  await verifyPasswordOrThrow(user, body.password);

  const placeholderEmail = `deleted+${user.id}@deleted.invalid`;
  const derived = await hashPassword(newSessionToken());
  const updated = rows(
    await db
      .from("users")
      .update({
        name: "Deleted customer",
        email: placeholderEmail,
        phone: null,
        password_salt: derived.salt,
        password_hash: derived.hash,
        password_iterations: derived.iterations,
        status: "suspended",
        marketing_opt_out: true,
        birth_date: null,
        two_factor_secret: null,
        two_factor_enabled_at: null,
        deleted_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq("id", user.id)
      .select("id"),
  );
  if (updated.length !== 1) throw new AppError("update_unconfirmed", 503);

  await invalidateRecoveryCodes(db, user.id);
  const phone = user.phone;

  if (phone) {
    const conversations = rows(
      await db
        .from("support_conversations")
        .select("id")
        .eq("customer_phone", phone)
        .limit(200),
    );
    for (const row of conversations) {
      await db
        .from("support_conversations")
        .update({ customer_name: "Deleted customer", customer_phone: null, user_id: null })
        .eq("id", row.id)
        .select("id");
    }
    const reviews = rows(
      await db.from("reviews").select("id").eq("phone", phone).limit(200),
    );
    for (const row of reviews) {
      await db
        .from("reviews")
        .update({ customer_name: "Deleted customer", phone: "+8800000000000", user_id: null })
        .eq("id", row.id)
        .select("id");
    }
    const ledger = rows(
      await db.from("loyalty_ledger").select("id").eq("phone", phone).limit(500),
    );
    for (const row of ledger) {
      await db
        .from("loyalty_ledger")
        .update({ phone: "+8800000000000", user_id: null })
        .eq("id", row.id)
        .select("id");
    }
  }

  const revokedSessions = await revokeAllSessions(db, user.id);
  await recordAudit(db, request, principal, {
    action: "account.delete",
    entityType: "user",
    entityId: user.id,
    summary: "Customer account deleted and anonymised",
    details: { revokedSessions, retainedOrders: true },
  });
  return json({ ok: true, revokedSessions });
}

// ---------------------------------------------------------------------------
// Owner customer export.

export async function handleAdminCustomerExport(db, request, principal, phone) {
  requirePermission(principal, "data.export");
  requireOwner(principal);
  const matched = rows(await db.from("users").select(SECURITY_USER_COLUMNS).eq("phone", phone).limit(1));
  const user = matched.length === 1
    ? matched[0]
    : {
        id: null,
        name: "Guest",
        email: null,
        phone,
        role_id: "customer",
        status: "guest",
        created_at: null,
        deleted_at: null,
        two_factor_enabled_at: null,
      };
  const data = await collectCustomerData(db, user);
  await recordAudit(db, request, principal, {
    action: "customer.export",
    entityType: "customer",
    entityId: phone,
    summary: `Customer data exported for ${phone}`,
    details: { orders: data.orders.length },
  });
  return json({ exportedAt: nowIso(), ...data });
}
