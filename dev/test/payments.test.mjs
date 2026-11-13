import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDb } from "./fake-db.mjs";
import { ORIGIN, PASSWORD, SANDBOX_ENV, call, login, makeApp, setupWithOwner } from "./helpers.mjs";
import { seedBaseline } from "../../functions/seed.mjs";
import { PRODUCTS } from "../../functions/seed-data/products.mjs";
import { VARIANTS } from "../../functions/seed-data/variants.mjs";
import { signWebhook } from "../../functions/payment-providers.mjs";

const MUG = PRODUCTS.find((product) => product.slug === "stone-ceramic-mug");
const MUG_STONE = VARIANTS.find(
  (variant) => variant.product_id === MUG.id && variant.option_label_en === "Stone",
);

async function ownerApp(env = SANDBOX_ENV) {
  const db = createFakeDb();
  await seedBaseline(db);
  const app = makeApp(db, env);
  await setupWithOwner(app);
  const owner = await login(app, "owner@lootpat.test");
  assert.equal(owner.status, 200, JSON.stringify(owner.json));
  return { db, app, ownerCookie: owner.cookie };
}

async function addStaff(app, ownerCookie, role, email) {
  const created = await call(app, "POST", "/api/admin/team", {
    cookie: ownerCookie,
    body: { name: `Test ${role}`, email, password: PASSWORD, role },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return (await login(app, email)).cookie;
}

function orderBody(paymentMethod, overrides = {}) {
  return {
    items: [{ productId: MUG.id, variantId: MUG_STONE.id, qty: 2 }],
    customer: {
      name: "Nila Hasan",
      phone: "01812345678",
      districtId: "dhaka",
      area: "Uttara",
      address: "House 9, Road 7, Uttara",
      marketingConsent: false,
    },
    paymentMethod,
    idempotencyKey: crypto.randomUUID(),
    ...overrides,
  };
}

async function enableBkash(app, ownerCookie) {
  const patched = await call(app, "PATCH", "/api/admin/settings", {
    cookie: ownerCookie,
    body: { payments: { bkashEnabled: true } },
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
}

async function onlineOrder(app, ownerCookie, ip = "198.51.100.61") {
  await enableBkash(app, ownerCookie);
  const created = await call(app, "POST", "/api/orders", {
    body: orderBody("bkash"),
    ip,
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return created.json;
}

async function sandboxSession(app, ownerOrder, provider = "bkash") {
  const created = await call(app, "POST", "/api/payments/session", {
    body: {
      orderNumber: ownerOrder.order.orderNumber,
      lookupToken: ownerOrder.lookupToken,
      provider,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const token = new URL(created.json.session.redirectUrl).searchParams.get("token");
  return { session: created.json.session, token };
}

test("store settings are readable by staff but payment flags are owner-only", async () => {
  const { app, ownerCookie } = await ownerApp();

  const anonymous = await call(app, "GET", "/api/admin/settings");
  assert.equal(anonymous.status, 401);

  const viewerCookie = await addStaff(app, ownerCookie, "viewer", "viewer@lootpat.test");
  const viewerRead = await call(app, "GET", "/api/admin/settings", { cookie: viewerCookie });
  assert.equal(viewerRead.status, 200);
  assert.equal(viewerRead.json.environment.mode, "sandbox");
  assert.equal(viewerRead.json.payments.bkashEnabled, true);
  assert.equal(viewerRead.json.store.nameBn, "লুটপাট বাজার");
  assert.equal(viewerRead.json.store.paymentNumber, "01410286822");

  const adminCookie = await addStaff(app, ownerCookie, "admin", "admin@lootpat.test");
  const adminStorePatch = await call(app, "PATCH", "/api/admin/settings", {
    cookie: adminCookie,
    body: { delivery: { codLimitPaisa: 900000 } },
  });
  assert.equal(adminStorePatch.status, 200);
  assert.equal(adminStorePatch.json.delivery.codLimitPaisa, 900000);

  const adminPaymentPatch = await call(app, "PATCH", "/api/admin/settings", {
    cookie: adminCookie,
    body: { payments: { bkashEnabled: true } },
  });
  assert.equal(adminPaymentPatch.status, 403);

  const viewerPatch = await call(app, "PATCH", "/api/admin/settings", {
    cookie: viewerCookie,
    body: { delivery: { codEnabled: false } },
  });
  assert.equal(viewerPatch.status, 403);

  // The response carries configuration status, never gateway credentials.
  const serialized = JSON.stringify(adminStorePatch.json);
  assert.ok(!/app_?secret|store_?password|api_?key/i.test(serialized));
});

test("owner enabling a gateway is audited and reaches the checkout config", async () => {
  const { app, ownerCookie } = await ownerApp();
  const disabled = await call(app, "PATCH", "/api/admin/settings", {
    cookie: ownerCookie,
    body: { payments: { bkashEnabled: false } },
  });
  assert.equal(disabled.status, 200, JSON.stringify(disabled.json));

  const before = await call(app, "GET", "/api/checkout/config");
  assert.equal(before.json.payments.bkash, false);
  assert.equal(before.json.gateway.mode, "sandbox");

  await enableBkash(app, ownerCookie);

  const after = await call(app, "GET", "/api/checkout/config");
  assert.equal(after.json.payments.bkash, true);
  assert.equal(after.json.gateway.providers.bkash.available, true);

  const audit = await call(app, "GET", "/api/admin/audit", { cookie: ownerCookie });
  assert.equal(audit.status, 200);
  const entry = audit.json.entries.find((row) => row.action === "settings.update");
  assert.ok(entry, "settings.update should be audited");
  assert.deepEqual(entry.details.keys, ["payments.bkash_enabled"]);
});

test("online checkout is refused while the gateway flag is off", async () => {
  const { app, ownerCookie } = await ownerApp();
  const disabled = await call(app, "PATCH", "/api/admin/settings", {
    cookie: ownerCookie,
    body: { payments: { bkashEnabled: false } },
  });
  assert.equal(disabled.status, 200, JSON.stringify(disabled.json));
  const rejected = await call(app, "POST", "/api/orders", {
    body: orderBody("bkash"),
    ip: "198.51.100.62",
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.json.error, "payment_method_unavailable");
});

test("manual wallet orders stay unpaid until the owner confirms", async () => {
  const { app, ownerCookie } = await ownerApp();
  const created = await call(app, "POST", "/api/orders", {
    body: orderBody("wallet"),
    ip: "198.51.100.67",
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.order.paymentMethod, "wallet");
  assert.equal(created.json.order.paymentStatus, "unpaid");

  const adminCookie = await addStaff(app, ownerCookie, "admin", "wallet-admin@lootpat.test");
  const denied = await call(
    app,
    "PATCH",
    `/api/admin/orders/${created.json.order.orderNumber}/payment`,
    { cookie: adminCookie, body: { paymentStatus: "paid" } },
  );
  assert.equal(denied.status, 403);

  const confirmed = await call(
    app,
    "PATCH",
    `/api/admin/orders/${created.json.order.orderNumber}/payment`,
    { cookie: ownerCookie, body: { paymentStatus: "paid", note: "bKash TrxID 9F7A" } },
  );
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  assert.equal(confirmed.json.order.paymentStatus, "paid");

  const audit = await call(app, "GET", "/api/admin/audit", { cookie: ownerCookie });
  assert.ok(audit.json.entries.some((row) => row.action === "order.payment"));
});

test("wallet checkout is refused when no wallet number is configured", async () => {
  const { app, ownerCookie } = await ownerApp();
  const cleared = await call(app, "PATCH", "/api/admin/settings", {
    cookie: ownerCookie,
    body: { store: { paymentNumber: "" } },
  });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.json));

  const rejected = await call(app, "POST", "/api/orders", {
    body: orderBody("wallet"),
    ip: "198.51.100.68",
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.json.error, "payment_method_unavailable");
});

test("sandbox session requires the order token and settles the order once", async () => {
  const { db, app, ownerCookie } = await ownerApp();
  const placed = await onlineOrder(app, ownerCookie);

  const guessed = await call(app, "POST", "/api/payments/session", {
    body: {
      orderNumber: placed.order.orderNumber,
      lookupToken: "0".repeat(32),
      provider: "bkash",
    },
  });
  assert.equal(guessed.status, 404);

  const wrongProvider = await call(app, "POST", "/api/payments/session", {
    body: {
      orderNumber: placed.order.orderNumber,
      lookupToken: placed.lookupToken,
      provider: "nagad",
    },
  });
  assert.equal(wrongProvider.status, 409);
  assert.equal(wrongProvider.json.error, "payment_method_mismatch");

  const { session, token } = await sandboxSession(app, placed);
  assert.equal(session.status, "pending");
  assert.ok(session.redirectUrl.startsWith(`${ORIGIN}/pay/`), session.redirectUrl);
  assert.equal(token.length, 48);

  const info = await call(
    app,
    "GET",
    `/api/payments/session/${session.id}?token=${token}`,
  );
  assert.equal(info.status, 200);
  assert.equal(info.json.session.amountPaisa, placed.order.totals.totalPaisa);
  assert.equal(info.json.session.orderNumber, placed.order.orderNumber);

  const badInfo = await call(
    app,
    "GET",
    `/api/payments/session/${session.id}?token=${"f".repeat(48)}`,
  );
  assert.equal(badInfo.status, 404);

  const completed = await call(app, "POST", `/api/payments/session/${session.id}/complete`, {
    body: { token, outcome: "success" },
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.json));
  assert.equal(completed.json.paid, true);
  assert.equal(
    completed.json.redirectUrl,
    `/order/${placed.order.orderNumber}?token=${placed.lookupToken}`,
  );

  const order = await call(
    app,
    "GET",
    `/api/orders/${placed.order.orderNumber}?token=${placed.lookupToken}`,
  );
  assert.equal(order.status, 200);
  assert.equal(order.json.order.paymentStatus, "paid");
  assert.equal(order.json.order.paymentSession.status, "paid");

  const events = db.dump("webhook_events");
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, "accepted");
  assert.equal(events[0].amount_paisa, placed.order.totals.totalPaisa);

  assert.ok(db.dump("sms_log").some((row) => row.template === "payment.paid"));

  const replay = await call(app, "POST", `/api/payments/session/${session.id}/complete`, {
    body: { token, outcome: "success" },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.json.paid, true);
  assert.equal(db.dump("webhook_events").length, 1, "settlement must stay idempotent");
});

test("a declined sandbox payment leaves the order unpaid", async () => {
  const { db, app, ownerCookie } = await ownerApp();
  const placed = await onlineOrder(app, ownerCookie, "198.51.100.63");
  const { session, token } = await sandboxSession(app, placed);

  const declined = await call(app, "POST", `/api/payments/session/${session.id}/complete`, {
    body: { token, outcome: "failure" },
  });
  assert.equal(declined.status, 200);
  assert.equal(declined.json.paid, false);

  const order = await call(
    app,
    "GET",
    `/api/orders/${placed.order.orderNumber}?token=${placed.lookupToken}`,
  );
  assert.equal(order.json.order.paymentStatus, "failed");
  assert.equal(order.json.order.paymentSession.status, "failed");
  assert.ok(!db.dump("sms_log").some((row) => row.template === "payment.paid"));
});

test("webhook signature, amount and replay rules hold without an Origin header", async () => {
  const { db, app, ownerCookie } = await ownerApp();
  const placed = await onlineOrder(app, ownerCookie, "198.51.100.64");

  const payload = {
    eventId: "evt-test-001",
    event: "payment.paid",
    orderNumber: placed.order.orderNumber,
    amountPaisa: placed.order.totals.totalPaisa,
    providerRef: "BKASH-TRX-001",
  };
  const raw = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await signWebhook(SANDBOX_ENV.WEBHOOK_SECRET, timestamp, raw);
  const headers = {
    origin: "https://gateway.example",
    "content-type": "application/json",
    "x-webhook-timestamp": timestamp,
    "x-webhook-signature": `sha256=${signature}`,
  };

  const forged = await call(app, "POST", "/api/payments/webhook/bkash", {
    raw,
    headers: { ...headers, "x-webhook-signature": `sha256=${"0".repeat(64)}` },
    ip: "198.51.100.65",
  });
  assert.equal(forged.status, 401);
  assert.equal(forged.json.error, "invalid_signature");

  const stale = await call(app, "POST", "/api/payments/webhook/bkash", {
    raw,
    headers: {
      ...headers,
      "x-webhook-timestamp": String(Math.floor(Date.now() / 1000) - 900),
    },
    ip: "198.51.100.65",
  });
  assert.equal(stale.status, 401);

  const accepted = await call(app, "POST", "/api/payments/webhook/bkash", {
    raw,
    headers,
    ip: "198.51.100.66",
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
  assert.equal(accepted.json.paid, true);

  const duplicate = await call(app, "POST", "/api/payments/webhook/bkash", {
    raw,
    headers,
    ip: "198.51.100.66",
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.json.duplicate, true);

  const mismatchPayload = { ...payload, eventId: "evt-test-002", amountPaisa: 1 };
  const mismatchRaw = JSON.stringify(mismatchPayload);
  const mismatchTimestamp = String(Math.floor(Date.now() / 1000));
  const mismatchSignature = await signWebhook(
    SANDBOX_ENV.WEBHOOK_SECRET,
    mismatchTimestamp,
    mismatchRaw,
  );
  const mismatch = await call(app, "POST", "/api/payments/webhook/bkash", {
    raw: mismatchRaw,
    headers: {
      origin: "https://gateway.example",
      "content-type": "application/json",
      "x-webhook-timestamp": mismatchTimestamp,
      "x-webhook-signature": mismatchSignature,
    },
    ip: "198.51.100.67",
  });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.json.error, "amount_mismatch");

  const order = await call(
    app,
    "GET",
    `/api/orders/${placed.order.orderNumber}?token=${placed.lookupToken}`,
  );
  assert.equal(order.json.order.paymentStatus, "paid");
  const events = db.dump("webhook_events");
  assert.equal(events.length, 2, "the replay must not add an event row");
  assert.deepEqual(
    events.map((row) => row.outcome).sort(),
    ["accepted", "rejected"],
  );
});

test("live mode keeps gateways unavailable until real credentials exist", async () => {
  const { app, ownerCookie } = await ownerApp({ ...SANDBOX_ENV, PAYMENTS_MODE: "live" });
  await enableBkash(app, ownerCookie);

  const config = await call(app, "GET", "/api/checkout/config");
  assert.equal(config.json.gateway.mode, "live");
  assert.equal(config.json.gateway.providers.bkash.enabled, true);
  assert.equal(config.json.gateway.providers.bkash.configured, false);
  assert.equal(config.json.gateway.providers.bkash.available, false);

  const rejected = await call(app, "POST", "/api/orders", {
    body: orderBody("bkash"),
    ip: "198.51.100.81",
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.json.error, "payment_method_unavailable");

  const sandboxInfo = await call(
    app,
    "GET",
    `/api/payments/session/${crypto.randomUUID()}?token=${"a".repeat(48)}`,
  );
  assert.equal(sandboxInfo.status, 404);
});

test("manual courier assignment ships the order and records tracking", async () => {
  const { db, app, ownerCookie } = await ownerApp();
  const created = await call(app, "POST", "/api/orders", {
    body: orderBody("cod", {
      customer: {
        name: "Nila Hasan",
        phone: "01812345679",
        districtId: "dhaka",
        area: "Uttara",
        address: "House 9, Road 7, Uttara",
        marketingConsent: false,
      },
    }),
    ip: "198.51.100.71",
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const number = created.json.order.orderNumber;

  const early = await call(app, "PATCH", `/api/admin/orders/${number}/courier`, {
    cookie: ownerCookie,
    body: { courier: "manual", trackingNumber: "PATHAO-1001" },
  });
  assert.equal(early.status, 409);
  assert.equal(early.json.error, "order_not_ready");

  const confirmed = await call(app, "PATCH", `/api/admin/orders/${number}/status`, {
    cookie: ownerCookie,
    body: { status: "confirmed" },
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));

  const viewerCookie = await addStaff(app, ownerCookie, "viewer", "viewer@lootpat.test");
  const viewerAssign = await call(app, "PATCH", `/api/admin/orders/${number}/courier`, {
    cookie: viewerCookie,
    body: { courier: "manual", trackingNumber: "PATHAO-1001" },
  });
  assert.equal(viewerAssign.status, 403);

  const assigned = await call(app, "PATCH", `/api/admin/orders/${number}/courier`, {
    cookie: ownerCookie,
    body: { courier: "manual", trackingNumber: "PATHAO-1001" },
  });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.json));
  assert.equal(assigned.json.order.status, "shipped");
  assert.equal(assigned.json.order.fulfilment.courier, "manual");
  assert.equal(assigned.json.order.fulfilment.trackingNumber, "PATHAO-1001");
  assert.equal(assigned.json.order.fulfilment.courierStatus, "booked");
  assert.ok(assigned.json.order.fulfilment.shippedAt);
  assert.deepEqual(assigned.json.courier, {
    provider: "manual",
    trackingNumber: "PATHAO-1001",
    automatic: false,
  });

  const orderRow = db.dump("orders").find((row) => row.order_number === number);
  const history = db
    .dump("order_status_history")
    .filter((row) => row.order_id === orderRow.id)
    .map((row) => row.status);
  assert.deepEqual([...history].sort(), ["confirmed", "pending", "shipped"]);
  assert.deepEqual(
    [...assigned.json.order.statusHistory.map((entry) => entry.status)].sort(),
    ["confirmed", "pending", "shipped"],
  );
  assert.ok(db.dump("sms_log").some((row) => row.template === "order.shipped"));

  const audit = await call(app, "GET", "/api/admin/audit", { cookie: ownerCookie });
  assert.ok(audit.json.entries.some((row) => row.action === "order.courier"));

  const detail = await call(app, "GET", `/api/admin/orders/${number}`, { cookie: ownerCookie });
  assert.equal(detail.status, 200);
  assert.ok(detail.json.couriers.some((courier) => courier.id === "manual" && courier.available));
});
