import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDb } from "./fake-db.mjs";
import { call, makeApp } from "./helpers.mjs";
import { seedBaseline } from "../../functions/seed.mjs";
import { PRODUCTS } from "../../functions/seed-data/products.mjs";
import { VARIANTS } from "../../functions/seed-data/variants.mjs";

const MUG = PRODUCTS.find((product) => product.slug === "stone-ceramic-mug");
const MUG_STONE = VARIANTS.find(
  (variant) => variant.product_id === MUG.id && variant.option_label_en === "Stone",
);
const WATCH = PRODUCTS.find((product) => product.slug === "pulse-x2-smartwatch");
const WATCH_MIDNIGHT = VARIANTS.find(
  (variant) => variant.product_id === WATCH.id && variant.option_label_en === "Midnight",
);
const EARBUDS = PRODUCTS.find((product) => product.slug === "airbeat-pro-earbuds");
const EARBUDS_MIDNIGHT = VARIANTS.find(
  (variant) => variant.product_id === EARBUDS.id && variant.option_label_en === "Midnight",
);

async function seededApp() {
  const db = createFakeDb();
  await seedBaseline(db);
  return { db, app: makeApp(db) };
}

function body(overrides = {}) {
  return {
    items: [{ productId: MUG.id, variantId: MUG_STONE.id, qty: 2 }],
    customer: {
      name: "Aditto Ahmed",
      phone: "01712345678",
      districtId: "dhaka",
      area: "Dhanmondi",
      address: "House 12, Road 4, Dhanmondi",
      marketingConsent: false,
    },
    paymentMethod: "cod",
    idempotencyKey: crypto.randomUUID(),
    ...overrides,
  };
}

function stockOf(db, table, id) {
  return db.dump(table).find((row) => row.id === id).stock;
}

test("checkout config exposes real delivery economics and enabled gateways", async () => {
  const { app } = await seededApp();
  const response = await call(app, "GET", "/api/checkout/config");
  assert.equal(response.status, 200);
  assert.equal(response.json.store.name.bn, "লুটপাট বাজার");
  assert.equal(response.json.delivery.dhakaPaisa, 6000);
  assert.equal(response.json.delivery.outsidePaisa, 12000);
  assert.equal(response.json.delivery.freeThresholdPaisa, 200000);
  assert.equal(response.json.delivery.codLimitPaisa, 1000000);
  assert.equal(response.json.payments.cod, true);
  assert.equal(response.json.payments.wallet, true);
  assert.equal(response.json.payments.bkash, true);
  assert.equal(response.json.payments.nagad, true);
  assert.equal(response.json.payments.sslcommerz, false);
  assert.equal(response.json.store.paymentNumber, "01410286822");
});

test("COD order recomputes totals, reserves stock and stays private", async () => {
  const { db, app } = await seededApp();
  const ip = "198.51.100.11";
  const productBefore = stockOf(db, "products", MUG.id);
  const variantBefore = stockOf(db, "product_variants", MUG_STONE.id);

  const created = await call(app, "POST", "/api/orders", { body: body(), ip });
  assert.equal(created.status, 201);
  const { order, lookupToken } = created.json;
  assert.match(order.orderNumber, /^LP-\d{6}-[0-9A-Z]{6}$/);
  assert.equal(lookupToken.length, 32);
  assert.equal(order.status, "pending");
  assert.equal(order.paymentStatus, "unpaid");
  assert.equal(order.customer.phone, "+8801712345678");
  assert.equal(order.totals.subtotalPaisa, 158000);
  assert.equal(order.totals.shippingPaisa, 6000);
  assert.equal(order.totals.totalPaisa, 164000);
  assert.equal(order.items.length, 1);
  assert.deepEqual(order.items[0].variantLabel, { bn: "স্টোন", en: "Stone" });
  assert.equal(order.items[0].unitPricePaisa, 79000);
  assert.equal(stockOf(db, "products", MUG.id), productBefore - 2);
  assert.equal(stockOf(db, "product_variants", MUG_STONE.id), variantBefore - 2);

  const withToken = await call(
    app,
    "GET",
    `/api/orders/${order.orderNumber}?token=${lookupToken}`,
    { ip },
  );
  assert.equal(withToken.status, 200);
  assert.equal(withToken.json.order.orderNumber, order.orderNumber);
  assert.equal(withToken.json.order.statusHistory.length, 1);

  const withoutToken = await call(app, "GET", `/api/orders/${order.orderNumber}`, { ip });
  assert.equal(withoutToken.status, 404);
  assert.equal(withoutToken.json.error, "order_not_found");

  const wrongToken = await call(
    app,
    "GET",
    `/api/orders/${order.orderNumber}?token=${"0".repeat(32)}`,
    { ip },
  );
  assert.equal(wrongToken.status, 404);
});

test("coupons apply server-side with limits and free shipping", async () => {
  const { app } = await seededApp();
  const quote = await call(app, "POST", "/api/coupons/validate", {
    body: { code: "welcome10", subtotalPaisa: 158000 },
    ip: "198.51.100.21",
  });
  assert.equal(quote.status, 200);
  assert.equal(quote.json.coupon.code, "WELCOME10");
  assert.equal(quote.json.discountPaisa, 15800);
  assert.equal(quote.json.freeShipping, false);

  const shipQuote = await call(app, "POST", "/api/coupons/validate", {
    body: { code: "FREESHIP", subtotalPaisa: 158000 },
    ip: "198.51.100.21",
  });
  assert.equal(shipQuote.status, 200);
  assert.equal(shipQuote.json.freeShipping, true);

  const discountOrder = await call(app, "POST", "/api/orders", {
    body: body({ couponCode: "WELCOME10" }),
    ip: "198.51.100.22",
  });
  assert.equal(discountOrder.status, 201);
  assert.equal(discountOrder.json.order.totals.discountPaisa, 15800);
  assert.equal(discountOrder.json.order.totals.totalPaisa, 148200);
  assert.equal(discountOrder.json.order.couponCode, "WELCOME10");

  const reused = await call(app, "POST", "/api/orders", {
    body: body({ couponCode: "WELCOME10" }),
    ip: "198.51.100.23",
  });
  assert.equal(reused.status, 409);
  assert.equal(reused.json.error, "coupon_invalid");
  assert.equal(reused.json.reason, "already_used");

  const freeShip = await call(app, "POST", "/api/orders", {
    body: body({
      couponCode: "FREESHIP",
      customer: {
        ...body().customer,
        phone: "01712345679",
      },
    }),
    ip: "198.51.100.24",
  });
  assert.equal(freeShip.status, 201);
  assert.equal(freeShip.json.order.totals.shippingPaisa, 0);
  assert.equal(freeShip.json.order.totals.totalPaisa, 158000);

  const minimum = await call(app, "POST", "/api/orders", {
    body: body({
      items: [{ productId: MUG.id, variantId: MUG_STONE.id, qty: 1 }],
      couponCode: "WELCOME10",
      customer: { ...body().customer, phone: "01712345670" },
    }),
    ip: "198.51.100.25",
  });
  assert.equal(minimum.status, 409);
  assert.equal(minimum.json.reason, "min_subtotal");
  assert.equal(minimum.json.minSubtotalPaisa, 100000);

  const unknown = await call(app, "POST", "/api/orders", {
    body: body({ couponCode: "NOPE2026", customer: { ...body().customer, phone: "01712345671" } }),
    ip: "198.51.100.26",
  });
  assert.equal(unknown.status, 409);
  assert.equal(unknown.json.error, "coupon_invalid");
});

test("free delivery starts at the configured merchandise threshold", async () => {
  const { app } = await seededApp();
  const created = await call(app, "POST", "/api/orders", {
    body: body({
      items: [{ productId: MUG.id, variantId: MUG_STONE.id, qty: 3 }],
      customer: { ...body().customer, phone: "01712345672", districtId: "chattogram" },
    }),
    ip: "198.51.100.31",
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.order.totals.subtotalPaisa, 237000);
  assert.equal(created.json.order.totals.shippingPaisa, 0);
  assert.equal(created.json.order.customer.district.name.en, "Chattogram");
});

test("outside Dhaka pays the configured charge and COD limit is enforced", async () => {
  const { db, app } = await seededApp();
  const small = await call(app, "POST", "/api/orders", {
    body: body({
      items: [{ productId: MUG.id, variantId: MUG_STONE.id, qty: 1 }],
      customer: { ...body().customer, phone: "01712345673", districtId: "sylhet" },
    }),
    ip: "198.51.100.41",
  });
  assert.equal(small.status, 201);
  assert.equal(small.json.order.totals.shippingPaisa, 12000);
  assert.equal(small.json.order.totals.totalPaisa, 91000);

  const before = stockOf(db, "product_variants", WATCH_MIDNIGHT.id);
  const limited = await call(app, "POST", "/api/orders", {
    body: body({
      items: [{ productId: WATCH.id, variantId: WATCH_MIDNIGHT.id, qty: 2 }],
      customer: { ...body().customer, phone: "01712345674" },
    }),
    ip: "198.51.100.42",
  });
  assert.equal(limited.status, 409);
  assert.equal(limited.json.error, "cod_limit_exceeded");
  assert.equal(limited.json.codLimitPaisa, 1000000);
  assert.equal(stockOf(db, "product_variants", WATCH_MIDNIGHT.id), before);
});

test("insufficient stock fails before any line is reserved", async () => {
  const { db, app } = await seededApp();
  const mugBefore = stockOf(db, "product_variants", MUG_STONE.id);
  const earbudBefore = stockOf(db, "product_variants", EARBUDS_MIDNIGHT.id);

  const created = await call(app, "POST", "/api/orders", {
    body: body({
      items: [
        { productId: MUG.id, variantId: MUG_STONE.id, qty: 1 },
        { productId: EARBUDS.id, variantId: EARBUDS_MIDNIGHT.id, qty: 6 },
      ],
      customer: { ...body().customer, phone: "01712345675" },
    }),
    ip: "198.51.100.51",
  });
  assert.equal(created.status, 409);
  assert.equal(created.json.error, "stock_unavailable");
  assert.equal(created.json.productId, EARBUDS.id);
  assert.equal(stockOf(db, "product_variants", MUG_STONE.id), mugBefore);
  assert.equal(stockOf(db, "product_variants", EARBUDS_MIDNIGHT.id), earbudBefore);
});

test("idempotency returns the same order without a second reservation", async () => {
  const { db, app } = await seededApp();
  const ip = "198.51.100.61";
  const payload = body();
  const before = stockOf(db, "products", MUG.id);

  const first = await call(app, "POST", "/api/orders", { body: payload, ip });
  assert.equal(first.status, 201);
  const second = await call(app, "POST", "/api/orders", { body: payload, ip });
  assert.equal(second.status, 200);
  assert.equal(second.json.order.orderNumber, first.json.order.orderNumber);
  assert.equal(stockOf(db, "products", MUG.id), before - 2);
  assert.equal(db.dump("orders").length, 1);
});

test("client-sent totals and unavailable payment methods are rejected", async () => {
  const { app } = await seededApp();
  const tampered = await call(app, "POST", "/api/orders", {
    body: { ...body(), totals: { totalPaisa: 1 } },
    ip: "198.51.100.71",
  });
  assert.equal(tampered.status, 400);
  assert.equal(tampered.json.error, "invalid_input");

  const card = await call(app, "POST", "/api/orders", {
    body: body({
      paymentMethod: "sslcommerz",
      customer: { ...body().customer, phone: "01712345676" },
    }),
    ip: "198.51.100.72",
  });
  assert.equal(card.status, 409);
  assert.equal(card.json.error, "payment_method_unavailable");
});

test("order tracking needs the matching phone and is rate limited", async () => {
  const { app } = await seededApp();
  const created = await call(app, "POST", "/api/orders", {
    body: body({ customer: { ...body().customer, phone: "01712345677" } }),
    ip: "198.51.100.81",
  });
  assert.equal(created.status, 201);
  const orderNumber = created.json.order.orderNumber;

  const tracked = await call(app, "POST", "/api/orders/track", {
    body: { orderNumber, phone: "01712345677" },
    ip: "198.51.100.82",
  });
  assert.equal(tracked.status, 200);
  assert.equal(tracked.json.order.orderNumber, orderNumber);
  assert.equal(tracked.json.lookupToken.length, 32);

  const wrongPhone = await call(app, "POST", "/api/orders/track", {
    body: { orderNumber, phone: "01799999999" },
    ip: "198.51.100.83",
  });
  assert.equal(wrongPhone.status, 404);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await call(app, "POST", "/api/orders/track", {
      body: { orderNumber, phone: "01799999999" },
      ip: "198.51.100.84",
    });
  }
  const blocked = await call(app, "POST", "/api/orders/track", {
    body: { orderNumber, phone: "01712345677" },
    ip: "198.51.100.84",
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error, "rate_limited");
});

test("checkout is limited per phone across attempts", async () => {
  const { app } = await seededApp();
  const ip = "198.51.100.91";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const created = await call(app, "POST", "/api/orders", { body: body(), ip });
    assert.equal(created.status, 201, `attempt ${attempt}`);
  }
  const blocked = await call(app, "POST", "/api/orders", { body: body(), ip });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error, "rate_limited");
});

test("signed-in orders are linked to the account and listed there", async () => {
  const { app } = await seededApp();
  const registered = await call(app, "POST", "/api/auth/register", {
    body: { name: "Rina Akter", phone: "01812345678", password: "LootPat#2026" },
    ip: "198.51.100.101",
  });
  assert.equal(registered.status, 201);
  const cookie = registered.cookie;

  const created = await call(app, "POST", "/api/orders", {
    body: body({
      customer: { ...body().customer, name: "Rina Akter", phone: "01812345678" },
    }),
    cookie,
    ip: "198.51.100.102",
  });
  assert.equal(created.status, 201);

  const listed = await call(app, "GET", "/api/account/orders", { cookie });
  assert.equal(listed.status, 200);
  assert.equal(listed.json.orders.length, 1);
  assert.equal(listed.json.orders[0].orderNumber, created.json.order.orderNumber);

  const privateLookup = await call(
    app,
    "GET",
    `/api/orders/${created.json.order.orderNumber}`,
    { cookie, ip: "198.51.100.103" },
  );
  assert.equal(privateLookup.status, 200);

  const noSession = await call(app, "GET", "/api/account/orders");
  assert.equal(noSession.status, 401);
});
