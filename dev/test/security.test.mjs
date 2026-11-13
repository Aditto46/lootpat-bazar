import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDb } from "./fake-db.mjs";
import { PASSWORD, call, login, makeApp, rawLogin, setupWithOwner } from "./helpers.mjs";
import { seedBaseline } from "../../functions/seed.mjs";
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  normalizeRecoveryCode,
  totpCode,
  verifyTotp,
} from "../../functions/totp.mjs";
import { PRODUCTS } from "../../functions/seed-data/products.mjs";
import { VARIANTS } from "../../functions/seed-data/variants.mjs";

const MUG = PRODUCTS.find((product) => product.slug === "stone-ceramic-mug");
const MUG_STONE = VARIANTS.find(
  (variant) => variant.product_id === MUG.id && variant.option_label_en === "Stone",
);

const db = createFakeDb();
const app = makeApp(db);

let ownerId = null;
let ownerSecret = null;
let ownerCookie = null;
let staleRecoveryCodes = [];
let recoveryCodes = [];

function wrongCode(code) {
  return String((Number(code) + 1) % 1000000).padStart(6, "0");
}

// Fixed-window counters would otherwise pool attempts across the whole file.
async function resetLimits(scope, subject) {
  await db
    .from("auth_limiter")
    .update({ window_started_at: "2000-01-01T00:00:00.000Z", attempt_count: 0 })
    .eq("key", `${scope}:${subject}`)
    .select("key");
}

test("TOTP matches RFC 6238 and recovery codes are digests only", async () => {
  const ascii = new TextEncoder().encode("12345678901234567890");
  const secret = base32Encode(ascii);
  assert.equal(secret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.deepEqual([...base32Decode(secret)], [...ascii]);

  assert.equal(await totpCode(secret, 59_000, 8), "94287082");
  assert.equal(await totpCode(secret, 1_111_111_109_000, 8), "07081804");
  assert.equal(await totpCode(secret, 59_000), "287082");
  assert.equal(await verifyTotp(secret, "287082", 59_000), true);
  assert.equal(await verifyTotp(secret, "287082", 59_000 + 30_000), true);
  assert.equal(await verifyTotp(secret, "287082", 59_000 + 30_000 * 5), false);
  assert.equal(await verifyTotp(secret, "287083", 59_000), false);
  assert.equal(await verifyTotp(secret, "abc123", 59_000), false);

  const codes = await generateRecoveryCodes(10);
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes.map((entry) => entry.digest)).size, 10);
  for (const entry of codes) {
    assert.match(entry.code, /^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);
    assert.match(entry.digest, /^[0-9a-f]{64}$/);
  }
  assert.equal(normalizeRecoveryCode("abcd-efghj"), "ABCDEFGHJ");
});

test("an owner must enrol a second factor before staff APIs open", async () => {
  await seedBaseline(db);
  const created = await setupWithOwner(app, { email: "owner@lootpat.test", name: "মালিক" });
  ownerId = created.owner.id;
  await resetLimits("login", "owner@lootpat.test");

  const first = await rawLogin(app, "owner@lootpat.test");
  assert.equal(first.status, 200);
  assert.equal(first.json.twoFactorSetupRequired, true);
  assert.equal(first.json.user.twoFactor.required, true);
  assert.equal(first.json.user.twoFactor.enabled, false);
  assert.ok(first.cookie);

  const blocked = await call(app, "GET", "/api/admin/team", { cookie: first.cookie });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.error, "two_factor_setup_required");

  const wrongPassword = await call(app, "POST", "/api/auth/2fa/setup", {
    cookie: first.cookie,
    body: { password: "WrongPass#2026" },
  });
  assert.equal(wrongPassword.status, 401);
  assert.equal(wrongPassword.json.error, "invalid_credentials");

  const setup = await call(app, "POST", "/api/auth/2fa/setup", {
    cookie: first.cookie,
    body: { password: PASSWORD },
  });
  assert.equal(setup.status, 200);
  ownerSecret = setup.json.secret;
  assert.match(ownerSecret, /^[A-Z2-7]{32}$/);
  assert.match(setup.json.otpauthUri, /^otpauth:\/\/totp\/LootPat%20Bazar/);

  const firstCode = await totpCode(ownerSecret);
  const rejected = await call(app, "POST", "/api/auth/2fa/enable", {
    cookie: first.cookie,
    body: { code: wrongCode(firstCode) },
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.json.error, "invalid_code");

  const enabled = await call(app, "POST", "/api/auth/2fa/enable", {
    cookie: first.cookie,
    body: { code: await totpCode(ownerSecret) },
  });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.json.enabled, true);
  staleRecoveryCodes = enabled.json.recoveryCodes;
  assert.equal(staleRecoveryCodes.length, 10);
  assert.match(staleRecoveryCodes[0], /^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);

  const rows = db.dump("user_recovery_codes").filter((row) => row.user_id === ownerId);
  assert.equal(rows.length, 10);
  const plaintext = new Set(staleRecoveryCodes.map((code) => normalizeRecoveryCode(code)));
  for (const row of rows) {
    assert.match(row.code_digest, /^[0-9a-f]{64}$/);
    assert.equal(plaintext.has(row.code_digest), false);
    assert.equal(row.used_at, null);
  }

  const team = await call(app, "GET", "/api/admin/team", { cookie: first.cookie });
  assert.equal(team.status, 200);
  assert.ok(team.json.team.some((member) => member.id === ownerId && member.twoFactorEnabled === true));

  const status = await call(app, "GET", "/api/auth/2fa/status", { cookie: first.cookie });
  assert.equal(status.status, 200);
  assert.deepEqual(
    {
      enabled: status.json.enabled,
      required: status.json.required,
      setupRequired: status.json.setupRequired,
      remaining: status.json.recoveryCodesRemaining,
    },
    { enabled: true, required: true, setupRequired: false, remaining: 10 },
  );

  // Owners may not switch their own mandatory factor off.
  const disable = await call(app, "POST", "/api/auth/2fa/disable", {
    cookie: first.cookie,
    body: { password: PASSWORD, code: await totpCode(ownerSecret) },
  });
  assert.equal(disable.status, 409);
  assert.equal(disable.json.error, "two_factor_required_for_role");

  const regenerated = await call(app, "POST", "/api/auth/2fa/recovery", {
    cookie: first.cookie,
    body: { password: PASSWORD, code: await totpCode(ownerSecret) },
  });
  assert.equal(regenerated.status, 200);
  recoveryCodes = regenerated.json.recoveryCodes;
  assert.equal(recoveryCodes.length, 10);
  assert.notEqual(recoveryCodes[0], staleRecoveryCodes[0]);

  const after = await call(app, "GET", "/api/auth/2fa/status", { cookie: first.cookie });
  assert.equal(after.json.recoveryCodesRemaining, 10);
  const regeneratedRows = db.dump("user_recovery_codes").filter((row) => row.user_id === ownerId);
  assert.equal(regeneratedRows.length, 20);
  assert.equal(regeneratedRows.filter((row) => row.used_at == null).length, 10);
  ownerCookie = first.cookie;
});

test("2FA sign-in needs a live challenge and a recovery code works once", async () => {
  await resetLimits("login", "owner@lootpat.test");
  const ip = "203.0.113.21";

  const passwordOnly = await rawLogin(app, "owner@lootpat.test");
  assert.equal(passwordOnly.status, 200);
  assert.equal(passwordOnly.json.twoFactorRequired, true);
  assert.equal(passwordOnly.json.challengeToken.length, 43);
  assert.equal(passwordOnly.cookie, null);

  const anonymous = await call(app, "GET", "/api/auth/me");
  assert.equal(anonymous.status, 401);

  const code = await totpCode(ownerSecret);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failure = await call(app, "POST", "/api/auth/login/2fa", {
      ip,
      body: { challengeToken: passwordOnly.json.challengeToken, code: wrongCode(code) },
    });
    assert.equal(failure.status, 401, `attempt ${attempt + 1}`);
    assert.equal(failure.json.error, "invalid_code");
  }
  const exhausted = await call(app, "POST", "/api/auth/login/2fa", {
    ip,
    body: { challengeToken: passwordOnly.json.challengeToken, code: await totpCode(ownerSecret) },
  });
  assert.equal(exhausted.status, 401);
  assert.equal(exhausted.json.error, "invalid_challenge");

  const fresh = await rawLogin(app, "owner@lootpat.test");
  const signedIn = await call(app, "POST", "/api/auth/login/2fa", {
    ip,
    body: { challengeToken: fresh.json.challengeToken, code: await totpCode(ownerSecret) },
  });
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.json.user.role.id, "owner");
  assert.equal(signedIn.json.user.twoFactor.enabled, true);
  assert.match(signedIn.setCookie, /lp\.session=/);

  const replay = await call(app, "POST", "/api/auth/login/2fa", {
    ip,
    body: { challengeToken: fresh.json.challengeToken, code: await totpCode(ownerSecret) },
  });
  assert.equal(replay.status, 401);
  assert.equal(replay.json.error, "invalid_challenge");

  const staleChallenge = await rawLogin(app, "owner@lootpat.test");
  const stale = await call(app, "POST", "/api/auth/login/2fa", {
    ip,
    body: { challengeToken: staleChallenge.json.challengeToken, recoveryCode: staleRecoveryCodes[0] },
  });
  assert.equal(stale.status, 401);
  assert.equal(stale.json.error, "invalid_code");

  const recoveryChallenge = await rawLogin(app, "owner@lootpat.test");
  const recovered = await call(app, "POST", "/api/auth/login/2fa", {
    ip,
    body: { challengeToken: recoveryChallenge.json.challengeToken, recoveryCode: recoveryCodes[0] },
  });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.json.user.id, ownerId);

  const reuseChallenge = await rawLogin(app, "owner@lootpat.test");
  const reused = await call(app, "POST", "/api/auth/login/2fa", {
    ip,
    body: { challengeToken: reuseChallenge.json.challengeToken, recoveryCode: recoveryCodes[0] },
  });
  assert.equal(reused.status, 401);
  assert.equal(reused.json.error, "invalid_code");

  const both = await call(app, "POST", "/api/auth/login/2fa", {
    body: { challengeToken: "A".repeat(43), code: "123456", recoveryCode: "ABCDE-FGHIJ" },
  });
  assert.equal(both.status, 400);
  assert.equal(both.json.error, "invalid_input");

  const status = await call(app, "GET", "/api/auth/2fa/status", { cookie: signedIn.cookie });
  assert.equal(status.json.recoveryCodesRemaining, 9);

  const failedAudit = await call(app, "GET", "/api/admin/audit?action=auth.2fa_failed", {
    cookie: signedIn.cookie,
  });
  assert.equal(failedAudit.status, 200);
  assert.ok(failedAudit.json.total >= 6);
  assert.ok(failedAudit.json.entries.every((entry) => entry.action === "auth.2fa_failed"));

  ownerCookie = signedIn.cookie;
});

test("changing a password revokes every session and rotates the hash", async () => {
  await resetLimits("login", "rina.security@example.com");
  const registered = await call(app, "POST", "/api/auth/register", {
    body: { name: "Rina", email: "rina.security@example.com", password: PASSWORD },
  });
  assert.equal(registered.status, 201);
  const cookie = registered.cookie;

  const wrong = await call(app, "POST", "/api/auth/password", {
    cookie,
    body: { currentPassword: "WrongPass#2026", newPassword: "NewLoot#2026x" },
  });
  assert.equal(wrong.status, 401);

  const unchanged = await call(app, "POST", "/api/auth/password", {
    cookie,
    body: { currentPassword: PASSWORD, newPassword: PASSWORD },
  });
  assert.equal(unchanged.status, 400);
  assert.equal(unchanged.json.error, "invalid_input");

  const changed = await call(app, "POST", "/api/auth/password", {
    cookie,
    body: { currentPassword: PASSWORD, newPassword: "NewLoot#2026x" },
  });
  assert.equal(changed.status, 200);
  assert.ok(changed.json.revokedSessions >= 1);
  assert.match(changed.setCookie, /Max-Age=0/);

  const oldSession = await call(app, "GET", "/api/auth/me", { cookie });
  assert.equal(oldSession.status, 401);

  const oldLogin = await login(app, "rina.security@example.com");
  assert.equal(oldLogin.status, 401);
  const newLogin = await login(app, "rina.security@example.com", "NewLoot#2026x");
  assert.equal(newLogin.status, 200);

  const audit = db.dump("audit_logs").filter((row) => row.action === "auth.password_changed");
  assert.ok(audit.length >= 1);
});

test("owners can reset a teammate's password and second factor", async () => {
  const created = await call(app, "POST", "/api/admin/team", {
    cookie: ownerCookie,
    body: {
      name: "Staff Nine",
      email: "staff.security@lootpat.test",
      password: PASSWORD,
      role: "staff",
    },
  });
  assert.equal(created.status, 201);
  const staffId = created.json.id;

  await resetLimits("login", "staff.security@lootpat.test");
  const staffLogin = await login(app, "staff.security@lootpat.test");
  assert.equal(staffLogin.status, 200);
  assert.equal(staffLogin.json.twoFactorSetupRequired, false);
  assert.equal(staffLogin.json.user.twoFactor.required, false);

  const setup = await call(app, "POST", "/api/auth/2fa/setup", {
    cookie: staffLogin.cookie,
    body: { password: PASSWORD },
  });
  assert.equal(setup.status, 200);
  const staffSecret = setup.json.secret;
  const enabled = await call(app, "POST", "/api/auth/2fa/enable", {
    cookie: staffLogin.cookie,
    body: { code: await totpCode(staffSecret) },
  });
  assert.equal(enabled.status, 200);

  const challenged = await rawLogin(app, "staff.security@lootpat.test");
  assert.equal(challenged.json.twoFactorRequired, true);
  const staffSession = await call(app, "POST", "/api/auth/login/2fa", {
    body: { challengeToken: challenged.json.challengeToken, code: await totpCode(staffSecret) },
  });
  assert.equal(staffSession.status, 200);

  const listed = await call(app, "GET", "/api/admin/team", { cookie: ownerCookie });
  const staffMember = listed.json.team.find((member) => member.id === staffId);
  assert.equal(staffMember.twoFactorEnabled, true);

  const resetFactor = await call(app, "POST", `/api/admin/team/${staffId}/2fa-reset`, {
    cookie: ownerCookie,
    body: {},
  });
  assert.equal(resetFactor.status, 200);
  assert.ok(resetFactor.json.revokedSessions >= 1);

  const afterReset = await call(app, "GET", "/api/admin/team", { cookie: ownerCookie });
  assert.equal(afterReset.json.team.find((member) => member.id === staffId).twoFactorEnabled, false);

  const passwordOnly = await rawLogin(app, "staff.security@lootpat.test");
  assert.equal(passwordOnly.status, 200);
  assert.equal(passwordOnly.json.twoFactorRequired, undefined);
  assert.equal(passwordOnly.json.twoFactorSetupRequired, false);

  const weak = await call(app, "POST", `/api/admin/team/${staffId}/password`, {
    cookie: ownerCookie,
    body: { password: "short" },
  });
  assert.equal(weak.status, 400);

  const reset = await call(app, "POST", `/api/admin/team/${staffId}/password`, {
    cookie: ownerCookie,
    body: { password: "TeamLoot#2026z" },
  });
  assert.equal(reset.status, 200);
  assert.ok(reset.json.revokedSessions >= 1);

  const oldSession = await call(app, "GET", "/api/auth/me", { cookie: staffSession.cookie });
  assert.equal(oldSession.status, 401);
  assert.equal((await login(app, "staff.security@lootpat.test")).status, 401);
  assert.equal((await login(app, "staff.security@lootpat.test", "TeamLoot#2026z")).status, 200);

  const self = await call(app, "POST", `/api/admin/team/${ownerId}/password`, {
    cookie: ownerCookie,
    body: { password: "OwnerLoot#2026z" },
  });
  assert.equal(self.status, 409);
  assert.equal(self.json.error, "cannot_modify_self");

  const missing = await call(app, "POST", `/api/admin/team/${crypto.randomUUID()}/password`, {
    cookie: ownerCookie,
    body: { password: "GhostLoot#2026z" },
  });
  assert.equal(missing.status, 404);

  const adminCreated = await call(app, "POST", "/api/admin/team", {
    cookie: ownerCookie,
    body: {
      name: "Admin Nine",
      email: "admin.security@lootpat.test",
      password: PASSWORD,
      role: "admin",
    },
  });
  assert.equal(adminCreated.status, 201);
  await resetLimits("login", "admin.security@lootpat.test");
  await resetLimits("login_2fa_ip", "unknown");
  const adminLogin = await login(app, "admin.security@lootpat.test");
  assert.equal(adminLogin.status, 200);

  const forbidden = await call(app, "POST", `/api/admin/team/${staffId}/password`, {
    cookie: adminLogin.cookie,
    body: { password: "OtherLoot#2026z" },
  });
  assert.equal(forbidden.status, 403);
});

test("owners create portable backups and export the filtered audit trail", async () => {
  const before = await call(app, "GET", "/api/admin/backups", { cookie: ownerCookie });
  assert.equal(before.status, 200);
  assert.deepEqual(before.json.backups, []);

  const created = await call(app, "POST", "/api/admin/backups", {
    cookie: ownerCookie,
    body: {},
  });
  assert.equal(created.status, 201);
  const backup = created.json.backup;
  assert.ok(backup.tableCount >= 30);
  assert.ok(backup.rowCount > 0);
  assert.ok(backup.sizeBytes > 0);
  assert.equal(backup.createdBy, ownerId);

  const listed = await call(app, "GET", "/api/admin/backups", { cookie: ownerCookie });
  assert.equal(listed.status, 200);
  assert.equal(listed.json.backups.length, 1);
  assert.equal(listed.json.backups[0].id, backup.id);

  const download = await call(app, "GET", backup.downloadUrl, { cookie: ownerCookie });
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-type"), /application\/json/);
  assert.match(download.headers.get("content-disposition"), /lootpat-backup-/);
  assert.ok(download.json.tables.users.length >= 1);
  assert.equal(download.json.tables.sessions, undefined);
  assert.equal(download.json.exportedAt, undefined);
  assert.equal(download.json.generatedBy.id, ownerId);

  const adminLogin = await login(app, "admin.security@lootpat.test");
  assert.equal(adminLogin.status, 200);
  assert.equal(
    (await call(app, "POST", "/api/admin/backups", { cookie: adminLogin.cookie, body: {} })).status,
    403,
  );
  assert.equal(
    (await call(app, "GET", "/api/admin/backups", { cookie: adminLogin.cookie })).status,
    403,
  );
  assert.equal(
    (await call(app, "GET", backup.downloadUrl, { cookie: adminLogin.cookie })).status,
    403,
  );

  const filtered = await call(app, "GET", "/api/admin/audit?action=backup.create&limit=5", {
    cookie: ownerCookie,
  });
  assert.equal(filtered.status, 200);
  assert.equal(filtered.json.total, 1);
  assert.equal(filtered.json.entries[0].action, "backup.create");
  assert.equal(filtered.json.entries[0].entityType, "backup");
  assert.equal(filtered.json.entries[0].entityId, backup.id);

  const searched = await call(app, "GET", "/api/admin/audit?q=Backup%20created", {
    cookie: ownerCookie,
  });
  assert.ok(searched.json.total >= 1);

  const exported = await call(app, "GET", "/api/admin/audit/export?action=backup.create", {
    cookie: ownerCookie,
  });
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("content-disposition"), /lootpat-audit\.json/);
  assert.equal(exported.json.total, 1);
  assert.equal(exported.json.entries.length, 1);

  assert.equal(
    (await call(app, "GET", "/api/admin/audit/export", { cookie: adminLogin.cookie })).status,
    403,
  );
  assert.equal(
    (await call(app, "GET", "/api/admin/audit", { cookie: adminLogin.cookie })).status,
    403,
  );
});

test("customers can export their data and delete their account, but staff cannot", async () => {
  const registered = await call(app, "POST", "/api/auth/register", {
    body: { name: "Rina Akter", phone: "01712345678", password: PASSWORD },
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.json.user.phone, "+8801712345678");
  const customerId = registered.json.user.id;

  const order = await call(app, "POST", "/api/orders", {
    body: {
      items: [{ productId: MUG.id, variantId: MUG_STONE.id, qty: 2 }],
      customer: {
        name: "Rina Akter",
        phone: "01712345678",
        districtId: "dhaka",
        area: "Dhanmondi",
        address: "House 12, Road 4, Dhanmondi",
        marketingConsent: true,
      },
      paymentMethod: "cod",
      idempotencyKey: crypto.randomUUID(),
    },
  });
  assert.equal(order.status, 201);

  const exported = await call(app, "GET", "/api/account/data-export", {
    cookie: registered.cookie,
  });
  assert.equal(exported.status, 200);
  assert.equal(exported.json.profile.phone, "+8801712345678");
  assert.equal(exported.json.orders.length, 1);
  assert.equal(exported.json.orders[0].orderNumber, order.json.order.orderNumber);
  assert.equal(exported.json.orderItems.length, 1);

  const ownerExport = await call(
    app,
    "GET",
    `/api/admin/customers/${encodeURIComponent("+8801712345678")}/export`,
    { cookie: ownerCookie },
  );
  assert.equal(ownerExport.status, 200);
  assert.equal(ownerExport.json.orders.length, 1);

  const adminLogin = await login(app, "admin.security@lootpat.test");
  const adminExport = await call(
    app,
    "GET",
    `/api/admin/customers/${encodeURIComponent("+8801712345678")}/export`,
    { cookie: adminLogin.cookie },
  );
  assert.equal(adminExport.status, 403);

  const staffBlocked = await call(app, "POST", "/api/account/delete", {
    cookie: ownerCookie,
    body: { password: PASSWORD, confirm: "DELETE" },
  });
  assert.equal(staffBlocked.status, 409);
  assert.equal(staffBlocked.json.error, "staff_account_delete_blocked");

  const badConfirm = await call(app, "POST", "/api/account/delete", {
    cookie: registered.cookie,
    body: { password: PASSWORD, confirm: "delete" },
  });
  assert.equal(badConfirm.status, 400);

  const badPassword = await call(app, "POST", "/api/account/delete", {
    cookie: registered.cookie,
    body: { password: "WrongPass#2026", confirm: "DELETE" },
  });
  assert.equal(badPassword.status, 401);

  const deleted = await call(app, "POST", "/api/account/delete", {
    cookie: registered.cookie,
    body: { password: PASSWORD, confirm: "DELETE" },
  });
  assert.equal(deleted.status, 200);
  assert.ok(deleted.json.revokedSessions >= 1);

  assert.equal((await call(app, "GET", "/api/auth/me", { cookie: registered.cookie })).status, 401);
  const row = db.dump("users").find((user) => user.id === customerId);
  assert.equal(row.name, "Deleted customer");
  assert.equal(row.phone, null);
  assert.match(row.email, /^deleted\+.+\@deleted\.invalid$/);
  assert.equal(row.status, "suspended");
  assert.ok(row.deleted_at);
  assert.equal((await login(app, "01712345678")).status, 401);

  // Orders stay for accounting, but the customer link is severed.
  const retained = db.dump("orders").find((entry) => entry.order_number === order.json.order.orderNumber);
  assert.ok(retained);
});

test("the owner IP allowlist narrows every staff API", async () => {
  const settings = await call(app, "GET", "/api/admin/settings", { cookie: ownerCookie });
  assert.equal(settings.status, 200);
  assert.equal(settings.json.security.ipAllowlist, "");
  assert.equal(settings.json.security.requireTwoFactor, true);

  const allowedIp = "203.0.113.9";
  const blockedIp = "198.51.100.4";
  const updated = await call(app, "PATCH", "/api/admin/settings", {
    cookie: ownerCookie,
    body: { security: { ipAllowlist: "203.0.113.0/24" } },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.security.ipAllowlist, "203.0.113.0/24");

  assert.equal(
    (await call(app, "GET", "/api/admin/team", { cookie: ownerCookie, ip: allowedIp })).status,
    200,
  );
  const denied = await call(app, "GET", "/api/admin/team", { cookie: ownerCookie, ip: blockedIp });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.error, "admin_ip_forbidden");

  // The allowlist only guards staff APIs; the storefront keeps serving.
  assert.equal((await call(app, "GET", "/api/health", { ip: blockedIp })).status, 200);

  const exact = await call(app, "PATCH", "/api/admin/settings", {
    cookie: ownerCookie,
    ip: allowedIp,
    body: { security: { ipAllowlist: " 198.51.100.77 " } },
  });
  assert.equal(exact.status, 200);
  assert.equal(
    (await call(app, "GET", "/api/admin/team", { cookie: ownerCookie, ip: "198.51.100.77" })).status,
    200,
  );
  assert.equal(
    (await call(app, "GET", "/api/admin/team", { cookie: ownerCookie, ip: allowedIp })).status,
    403,
  );

  const adminLogin = await login(app, "admin.security@lootpat.test");
  const adminBlocked = await call(app, "PATCH", "/api/admin/settings", {
    cookie: adminLogin.cookie,
    ip: "198.51.100.77",
    body: { security: { ipAllowlist: "" } },
  });
  assert.equal(adminBlocked.status, 403);

  const tooLong = await call(app, "PATCH", "/api/admin/settings", {
    cookie: ownerCookie,
    ip: "198.51.100.77",
    body: { security: { ipAllowlist: "1".repeat(501) } },
  });
  assert.equal(tooLong.status, 400);
});
