import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDb } from "./fake-db.mjs";
import { BASE, ORIGIN, PASSWORD, SETUP_TOKEN, call, login, makeApp, setupWithOwner } from "./helpers.mjs";
import { createApplication } from "../../functions/app.mjs";
import { sha256Hex } from "../../functions/sessions.mjs";
import { verifyPassword } from "../../functions/passwords.mjs";

const db = createFakeDb();
const app = makeApp(db);

let ownerId = null;
let ownerCookie = null;

test("setup rejects a wrong token and creates the first owner once", async () => {
  const denied = await call(app, "POST", "/api/setup", {
    headers: { "x-setup-token": "wrong-token" },
    body: {},
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.error, "setup_forbidden");

  const created = await setupWithOwner(app, { email: "owner@lootpat.test", name: "মালিক" });
  assert.equal(created.ok, true);
  assert.equal(created.ownerCreated, true);
  ownerId = created.owner.id;

  const counts = Object.fromEntries(created.seeded.map((entry) => [entry.table, entry.inserted]));
  assert.equal(counts.products, 20);
  assert.equal(counts.districts, 64);

  const again = await call(app, "POST", "/api/setup", {
    headers: { "x-setup-token": SETUP_TOKEN },
    body: { owner: { name: "Second", email: "second@lootpat.test", password: PASSWORD } },
  });
  assert.equal(again.status, 200);
  assert.equal(again.json.ownerCreated, false);
  assert.equal(again.json.ownerExists, true);
  assert.equal(db.dump("users").filter((user) => user.role_id === "owner").length, 1);
});

test("owner login and session introspection", async () => {
  const result = await login(app, "owner@lootpat.test");
  assert.equal(result.status, 200);
  assert.equal(result.json.user.role.id, "owner");
  assert.ok(result.json.user.permissions.includes("team.write"));
  ownerCookie = result.cookie;

  const me = await call(app, "GET", "/api/auth/me", { cookie: ownerCookie });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.email, "owner@lootpat.test");
  assert.ok(me.json.session.expiresAt);

  const cookieAttributes = result.setCookie;
  assert.match(cookieAttributes, /lp\.session=/);
  assert.match(cookieAttributes, /HttpOnly/);
  assert.match(cookieAttributes, /SameSite=Lax/);
  assert.doesNotMatch(cookieAttributes, /Secure/);
});

test("customer registration stores a hash and starts a session", async () => {
  const registered = await call(app, "POST", "/api/auth/register", {
    body: { name: "রিনা", email: "Rina@Example.com", password: PASSWORD },
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.json.user.email, "rina@example.com");
  assert.equal(registered.json.user.role.id, "customer");
  assert.deepEqual(registered.json.user.permissions, []);

  const row = db.dump("users").find((user) => user.email === "rina@example.com");
  assert.ok(row.password_hash.length > 20);
  assert.notEqual(row.password_hash, PASSWORD);
  assert.notEqual(row.password_salt, PASSWORD);
  assert.equal(await verifyPassword(PASSWORD, { salt: row.password_salt, hash: row.password_hash, iterations: row.password_iterations }), true);

  const me = await call(app, "GET", "/api/auth/me", { cookie: registered.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.name, "রিনা");

  const duplicate = await call(app, "POST", "/api/auth/register", {
    body: { name: "রিনা", email: "rina@example.com", password: PASSWORD },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.json.error, "account_exists");
});

test("phone registration accepts local format and logs in", async () => {
  const registered = await call(app, "POST", "/api/auth/register", {
    body: { name: "Kabir", phone: "01712345678", password: PASSWORD },
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.json.user.phone, "+8801712345678");

  const signedIn = await login(app, "01712345678");
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.json.user.phone, "+8801712345678");
});

test("input validation and CSRF are enforced", async () => {
  const weak = await call(app, "POST", "/api/auth/register", {
    body: { name: "Weak", email: "weak@example.com", password: "short" },
  });
  assert.equal(weak.status, 400);
  assert.equal(weak.json.error, "invalid_input");

  const unknownField = await call(app, "POST", "/api/auth/register", {
    body: { name: "Extra", email: "extra@example.com", password: PASSWORD, role_id: "owner" },
  });
  assert.equal(unknownField.status, 400);

  const noOrigin = await call(app, "POST", "/api/auth/login", {
    headers: { origin: "" },
    body: { identifier: "owner@lootpat.test", password: PASSWORD },
  });
  // Empty origin header is still not the trusted origin.
  assert.equal(noOrigin.status, 403);
  assert.equal(noOrigin.json.error, "origin_forbidden");

  const badContentType = await call(app, "POST", "/api/auth/login", {
    headers: { "content-type": "text/plain" },
    body: {},
  });
  assert.equal(badContentType.status, 400);
});

test("wrong password fails and repeated attempts lock the identifier", async () => {
  const wrong = await login(app, "owner@lootpat.test", "WrongPass#2026");
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.error, "invalid_credentials");

  await call(app, "POST", "/api/auth/register", {
    body: { name: "Lock", email: "lock@example.com", password: PASSWORD },
  });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const failure = await login(app, "lock@example.com", `WrongPass#202${attempt}`);
    assert.equal(failure.status, 401, `attempt ${attempt + 1}`);
  }
  const locked = await login(app, "lock@example.com", PASSWORD);
  assert.equal(locked.status, 429);
  assert.equal(locked.json.error, "rate_limited");
  assert.ok(Number(locked.headers.get("retry-after")) >= 1);
});

test("team permissions follow the seeded RBAC matrix", async () => {
  const createdAdmin = await call(app, "POST", "/api/admin/team", {
    cookie: ownerCookie,
    body: { name: "Admin", email: "admin@lootpat.test", password: PASSWORD, role: "admin" },
  });
  assert.equal(createdAdmin.status, 201);

  const createdViewer = await call(app, "POST", "/api/admin/team", {
    cookie: ownerCookie,
    body: { name: "Viewer", email: "viewer@lootpat.test", password: PASSWORD, role: "viewer" },
  });
  assert.equal(createdViewer.status, 201);
  const viewerId = createdViewer.json.id;

  const ownerCannotInviteOwner = await call(app, "POST", "/api/admin/team", {
    cookie: ownerCookie,
    body: { name: "Owner 2", email: "owner2@lootpat.test", password: PASSWORD, role: "owner" },
  });
  assert.equal(ownerCannotInviteOwner.status, 400);

  const adminLogin = await login(app, "admin@lootpat.test");
  assert.equal(adminLogin.status, 200);
  assert.ok(adminLogin.json.user.permissions.includes("orders.write"));
  assert.equal(adminLogin.json.user.permissions.includes("team.write"), false);

  const adminList = await call(app, "GET", "/api/admin/team", { cookie: adminLogin.cookie });
  assert.equal(adminList.status, 200);
  assert.ok(adminList.json.team.length >= 3);

  const adminInvite = await call(app, "POST", "/api/admin/team", {
    cookie: adminLogin.cookie,
    body: { name: "Nope", email: "nope@lootpat.test", password: PASSWORD, role: "staff" },
  });
  assert.equal(adminInvite.status, 403);

  const viewerLogin = await login(app, "viewer@lootpat.test");
  assert.equal(viewerLogin.status, 200);
  assert.ok(viewerLogin.json.user.permissions.includes("products.read"));
  assert.equal(viewerLogin.json.user.permissions.includes("products.write"), false);

  const viewerList = await call(app, "GET", "/api/admin/team", { cookie: viewerLogin.cookie });
  assert.equal(viewerList.status, 200);

  const viewerInvite = await call(app, "POST", "/api/admin/team", {
    cookie: viewerLogin.cookie,
    body: { name: "Nope", email: "nope2@lootpat.test", password: PASSWORD, role: "staff" },
  });
  assert.equal(viewerInvite.status, 403);

  const promoted = await call(app, "PATCH", `/api/admin/team/${viewerId}`, {
    cookie: ownerCookie,
    body: { role: "staff" },
  });
  assert.equal(promoted.status, 200);
  assert.equal(promoted.json.user.role, "staff");
  assert.ok(promoted.json.revokedSessions >= 1);

  const staleSession = await call(app, "GET", "/api/auth/me", { cookie: viewerLogin.cookie });
  assert.equal(staleSession.status, 401);

  const selfEdit = await call(app, "PATCH", `/api/admin/team/${ownerId}`, {
    cookie: ownerCookie,
    body: { role: "admin" },
  });
  assert.equal(selfEdit.status, 409);
  assert.equal(selfEdit.json.error, "cannot_modify_self");

  const anonymousList = await call(app, "GET", "/api/admin/team");
  assert.equal(anonymousList.status, 401);
});

test("suspending an account blocks login and revokes sessions", async () => {
  const created = await call(app, "POST", "/api/admin/team", {
    cookie: ownerCookie,
    body: { name: "Staff", email: "staff@lootpat.test", password: PASSWORD, role: "staff" },
  });
  assert.equal(created.status, 201);

  const signedIn = await login(app, "staff@lootpat.test");
  assert.equal(signedIn.status, 200);

  const suspended = await call(app, "PATCH", `/api/admin/team/${created.json.id}`, {
    cookie: ownerCookie,
    body: { status: "suspended" },
  });
  assert.equal(suspended.status, 200);

  const me = await call(app, "GET", "/api/auth/me", { cookie: signedIn.cookie });
  assert.equal(me.status, 401);

  const blocked = await login(app, "staff@lootpat.test");
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.error, "account_suspended");
});

test("expired sessions and logout-all revoke access", async () => {
  const first = await login(app, "rina@example.com");
  assert.equal(first.status, 200);
  const second = await login(app, "rina@example.com");
  assert.equal(second.status, 200);

  const token = first.cookie.split("=")[1];
  const digest = await sha256Hex(token);
  await db.from("sessions").update({ expires_at: "2000-01-01T00:00:00.000Z" }).eq("token_digest", digest).select("token_digest");

  const expired = await call(app, "GET", "/api/auth/me", { cookie: first.cookie });
  assert.equal(expired.status, 401);

  const all = await call(app, "POST", "/api/auth/logout-all", { cookie: second.cookie });
  assert.equal(all.status, 200);
  assert.ok(all.json.revokedSessions >= 1);

  const after = await call(app, "GET", "/api/auth/me", { cookie: second.cookie });
  assert.equal(after.status, 401);
});

test("logout clears the cookie and invalidates that session only", async () => {
  const one = await login(app, "rina@example.com");
  const two = await login(app, "rina@example.com");

  const out = await call(app, "POST", "/api/auth/logout", { cookie: one.cookie });
  assert.equal(out.status, 200);
  assert.match(out.setCookie, /Max-Age=0/);

  const gone = await call(app, "GET", "/api/auth/me", { cookie: one.cookie });
  assert.equal(gone.status, 401);
  const still = await call(app, "GET", "/api/auth/me", { cookie: two.cookie });
  assert.equal(still.status, 200);
});

test("a database with no token seeds once and then requires the configured token", async () => {
  const fresh = createApplication({ db: createFakeDb(), origin: ORIGIN, setupToken: undefined, env: {} });
  const created = await call(fresh, "POST", "/api/setup", {
    body: { owner: { name: "Owner", email: "first@lootpat.test", password: PASSWORD } },
  });
  assert.equal(created.status, 200);
  assert.equal(created.json.ownerCreated, true);

  const second = await call(fresh, "POST", "/api/setup", {
    body: { owner: { name: "Other", email: "second@lootpat.test", password: PASSWORD } },
  });
  assert.equal(second.status, 403);
  assert.equal(second.json.error, "setup_forbidden");
});

test("without APP_ORIGIN the request origin is enforced for writes", async () => {
  const db2 = createFakeDb();
  const derived = createApplication({
    db: db2,
    origin: (request) => new URL(request.url).origin,
    setupToken: SETUP_TOKEN,
    env: {},
  });
  const wrong = await call(derived, "POST", "/api/setup", {
    headers: { origin: "https://evil.example", "x-setup-token": SETUP_TOKEN },
    body: {},
  });
  assert.equal(wrong.status, 403);

  const requestOrigin = new URL(BASE).origin;
  const right = await call(derived, "POST", "/api/setup", {
    headers: { origin: requestOrigin, "x-setup-token": SETUP_TOKEN },
    body: {},
  });
  assert.equal(right.status, 200);
});
