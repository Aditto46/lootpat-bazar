import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDb } from "./fake-db.mjs";
import { PASSWORD, call, login, makeApp, setupWithOwner } from "./helpers.mjs";
import { seedBaseline } from "../../functions/seed.mjs";
import { PRODUCTS } from "../../functions/seed-data/products.mjs";
import { VARIANTS } from "../../functions/seed-data/variants.mjs";

const MUG = PRODUCTS.find((product) => product.slug === "stone-ceramic-mug");
const MUG_STONE = VARIANTS.find(
  (variant) => variant.product_id === MUG.id && variant.option_label_en === "Stone",
);
const EARBUDS = PRODUCTS.find((product) => product.slug === "airbeat-pro-earbuds");
const EARBUDS_MIDNIGHT = VARIANTS.find(
  (variant) => variant.product_id === EARBUDS.id && variant.option_label_en === "Midnight",
);

async function marketingApp() {
  const db = createFakeDb();
  await seedBaseline(db);
  const app = makeApp(db);
  await setupWithOwner(app);
  const owner = await login(app, "owner@lootpat.test");
  assert.equal(owner.status, 200, JSON.stringify(owner.json));
  return { db, app, ownerCookie: owner.cookie };
}

function orderBody(phone = "01712345678", overrides = {}) {
  return {
    items: [{ productId: MUG.id, variantId: MUG_STONE.id, qty: 1 }],
    customer: {
      name: "Nila Hasan",
      phone,
      districtId: "dhaka",
      area: "Uttara",
      address: "House 9, Road 7, Uttara",
      marketingConsent: false,
    },
    paymentMethod: "cod",
    idempotencyKey: crypto.randomUUID(),
    ...overrides,
  };
}

async function deliveredOrder(app, ownerCookie, phone = "01712345678") {
  const created = await call(app, "POST", "/api/orders", { body: orderBody(phone) });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const orderNumber = created.json.order.orderNumber;
  for (const status of ["confirmed", "packed", "shipped", "delivered"]) {
    const moved = await call(app, "PATCH", `/api/admin/orders/${orderNumber}/status`, {
      cookie: ownerCookie,
      body: { status },
    });
    assert.equal(moved.status, 200, `${status}: ${JSON.stringify(moved.json)}`);
  }
  return created.json.order;
}

test("seeded reviews are public, approved and summarised from live rows", async () => {
  const { app } = await marketingApp();

  const response = await call(app, "GET", "/api/catalog/products/airbeat-pro-earbuds/reviews");
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.equal(response.json.summary.count, 2);
  assert.equal(response.json.summary.averageTenths, 45);
  assert.equal(response.json.summary.breakdown["5"], 1);
  assert.equal(response.json.summary.breakdown["4"], 1);
  assert.equal(response.json.reviews.length, 2);
  assert.ok(response.json.reviews.every((review) => review.verifiedPurchase === false));
  assert.ok(response.json.reviews.every((review) => review.reply === null));
});

test("a review needs a delivered order, is verified, unique and photo-checked", async () => {
  const { db, app, ownerCookie } = await marketingApp();

  const pendingOrder = await call(app, "POST", "/api/orders", { body: orderBody() });
  assert.equal(pendingOrder.status, 201);
  const early = await call(app, "POST", "/api/reviews", {
    body: {
      orderNumber: pendingOrder.json.order.orderNumber,
      phone: "01712345678",
      productId: MUG.id,
      rating: 5,
      body: "খুব ভালো প্রোডাক্ট, দ্রুত ডেলিভারি পেয়েছি।",
      photos: [],
    },
  });
  assert.equal(early.status, 409);
  assert.equal(early.json.error, "order_not_delivered");

  const order = await deliveredOrder(app, ownerCookie);

  const wrongPhone = await call(app, "POST", "/api/reviews", {
    body: {
      orderNumber: order.orderNumber,
      phone: "01799999999",
      productId: MUG.id,
      rating: 5,
      body: "খুব ভালো প্রোডাক্ট, দ্রুত ডেলিভারি পেয়েছি।",
      photos: [],
    },
  });
  assert.equal(wrongPhone.status, 404);

  const badPhoto = await call(app, "POST", "/api/reviews", {
    body: {
      orderNumber: order.orderNumber,
      phone: "01712345678",
      productId: MUG.id,
      rating: 5,
      body: "খুব ভালো প্রোডাক্ট, দ্রুত ডেলিভারি পেয়েছি।",
      photos: [`data:image/png;base64,${"A".repeat(60)}`],
    },
  });
  assert.equal(badPhoto.status, 400);
  assert.equal(badPhoto.json.error, "photo_invalid");

  const submitted = await call(app, "POST", "/api/reviews", {
    body: {
      orderNumber: order.orderNumber,
      phone: "01712345678",
      productId: MUG.id,
      rating: 5,
      title: "দুর্দান্ত",
      body: "খুব ভালো প্রোডাক্ট, দ্রুত ডেলিভারি পেয়েছি।",
      photos: [],
    },
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.json));
  assert.equal(submitted.json.review.status, "pending");

  const stored = db.dump("reviews").find((row) => row.id === submitted.json.review.id);
  assert.equal(stored.verified_purchase, true);

  const duplicate = await call(app, "POST", "/api/reviews", {
    body: {
      orderNumber: order.orderNumber,
      phone: "01712345678",
      productId: MUG.id,
      rating: 4,
      body: "আবার রিভিউ দেওয়ার চেষ্টা করছি।",
      photos: [],
    },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.json.error, "review_exists");
});

test("a viewer cannot moderate reviews; approval publishes and rewards the buyer", async () => {
  const { db, app, ownerCookie } = await marketingApp();

  const created = await call(app, "POST", "/api/admin/team", {
    cookie: ownerCookie,
    body: { name: "View Only", email: "viewer@lootpat.test", password: PASSWORD, role: "viewer" },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const viewerCookie = (await login(app, "viewer@lootpat.test")).cookie;

  const order = await deliveredOrder(app, ownerCookie);
  const submitted = await call(app, "POST", "/api/reviews", {
    body: {
      orderNumber: order.orderNumber,
      phone: "01712345678",
      productId: MUG.id,
      rating: 5,
      body: "প্যাকেজিং খুব যত্নসহকারে ছিল, ধন্যবাদ।",
      photos: [],
    },
  });
  assert.equal(submitted.status, 201);
  const reviewId = submitted.json.review.id;

  const forbidden = await call(app, "PATCH", `/api/admin/reviews/${reviewId}`, {
    cookie: viewerCookie,
    body: { status: "approved" },
  });
  assert.equal(forbidden.status, 403);

  const approved = await call(app, "PATCH", `/api/admin/reviews/${reviewId}`, {
    cookie: ownerCookie,
    body: { status: "approved", reply: "ধন্যবাদ! আবার আসবেন।" },
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.json));
  assert.equal(approved.json.review.status, "approved");
  assert.equal(approved.json.review.reply, "ধন্যবাদ! আবার আসবেন।");

  const publicList = await call(app, "GET", "/api/catalog/products/stone-ceramic-mug/reviews");
  assert.equal(publicList.status, 200);
  assert.equal(publicList.json.reviews.length, 1);
  assert.equal(publicList.json.reviews[0].verifiedPurchase, true);
  assert.equal(publicList.json.reviews[0].reply.body, "ধন্যবাদ! আবার আসবেন।");

  const ledger = db.dump("loyalty_ledger").filter((row) => row.reason === "review_reward");
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].points, 20);

  const helpful = await call(app, "POST", `/api/reviews/${reviewId}/helpful`, {
    body: { voterKey: "voter-test-key-0001" },
  });
  assert.equal(helpful.status, 200);
  assert.equal(helpful.json.helpfulCount, 1);

  const again = await call(app, "POST", `/api/reviews/${reviewId}/helpful`, {
    body: { voterKey: "voter-test-key-0001" },
  });
  assert.equal(again.status, 200);
  assert.equal(again.json.helpfulCount, 1, "one vote per voter");

  const audit = await call(app, "GET", "/api/admin/audit", { cookie: ownerCookie });
  assert.ok(audit.json.entries.some((entry) => entry.action === "review.update"));
});

test("the spin wheel pays once per visitor and mints a real coupon", async () => {
  const { db, app } = await marketingApp();

  const config = await call(app, "GET", "/api/marketing/spin");
  assert.equal(config.status, 200);
  assert.equal(config.json.enabled, true);
  assert.equal(config.json.prizes.length, 4);
  assert.ok(!("weight" in config.json.prizes[0]), "weights stay server-side");

  const played = await call(app, "POST", "/api/marketing/spin", {
    body: { visitorKey: "visitor-test-key-0001" },
  });
  assert.equal(played.status, 200, JSON.stringify(played.json));
  assert.equal(played.json.alreadyPlayed, false);
  assert.match(played.json.couponCode, /^SPIN-[A-Z0-9]{6}$/);

  const coupon = db.dump("coupons").find((row) => row.code === played.json.couponCode);
  assert.ok(coupon, "the prize must exist as a normal coupon row");

  const replay = await call(app, "POST", "/api/marketing/spin", {
    body: { visitorKey: "visitor-test-key-0001" },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.json.alreadyPlayed, true);
  assert.equal(replay.json.couponCode, played.json.couponCode);
  assert.equal(db.dump("spin_results").length, 1);
});

test("flash sale prices are applied on the server, never sent by the client", async () => {
  const { app } = await marketingApp();

  const sale = await call(app, "GET", "/api/marketing/flash-sale");
  assert.equal(sale.status, 200);
  assert.equal(sale.json.sale.id, "weekend-flash");
  assert.equal(sale.json.sale.discountPercent, 20);
  const flashItem = sale.json.sale.items.find((item) => item.productId === EARBUDS.id);
  assert.ok(flashItem, "the first seeded product must be on sale");

  const created = await call(app, "POST", "/api/orders", {
    body: orderBody("01712345678", {
      items: [{ productId: EARBUDS.id, variantId: EARBUDS_MIDNIGHT.id, qty: 1 }],
    }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.order.items[0].unitPricePaisa, flashItem.salePricePaisa);
  assert.ok(
    created.json.order.items[0].unitPricePaisa < EARBUDS_MIDNIGHT.price_paisa,
    "the sale price must beat the variant price",
  );

  const tampered = await call(app, "POST", "/api/orders", {
    body: orderBody("01712345678", {
      items: [
        {
          productId: EARBUDS.id,
          variantId: EARBUDS_MIDNIGHT.id,
          qty: 1,
          unitPricePaisa: 1,
        },
      ],
    }),
  });
  assert.equal(tampered.status, 400, "prices in the payload are rejected outright");
});

test("loyalty tracks delivered orders and blocks a redeem below the minimum", async () => {
  const { app, ownerCookie } = await marketingApp();

  const order = await deliveredOrder(app, ownerCookie, "01812345678");
  const registered = await call(app, "POST", "/api/auth/register", {
    body: { name: "Loyal Buyer", phone: "01812345678", password: PASSWORD },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.json));

  const loyalty = await call(app, "GET", "/api/marketing/loyalty", {
    cookie: registered.cookie,
  });
  assert.equal(loyalty.status, 200, JSON.stringify(loyalty.json));
  const expected = Math.floor(order.totals.totalPaisa / 10000) * 1;
  assert.equal(loyalty.json.balance, expected);
  assert.ok(loyalty.json.ledger.some((entry) => entry.reason === "order_delivered"));

  const redeem = await call(app, "POST", "/api/marketing/loyalty/redeem", {
    cookie: registered.cookie,
    body: { points: 100 },
  });
  assert.equal(redeem.status, 409);
  assert.equal(redeem.json.error, "insufficient_points");

  const profile = await call(app, "PATCH", "/api/account/profile", {
    cookie: registered.cookie,
    body: { birthDate: "1995-04-12" },
  });
  assert.equal(profile.status, 200, JSON.stringify(profile.json));
  assert.equal(profile.json.profile.birthDate, "1995-04-12");
});

test("coupon and campaign writes are owner-only, validated and audited", async () => {
  const { app, ownerCookie } = await marketingApp();

  const created = await call(app, "POST", "/api/admin/team", {
    cookie: ownerCookie,
    body: { name: "View Only", email: "viewer@lootpat.test", password: PASSWORD, role: "viewer" },
  });
  assert.equal(created.status, 201);
  const viewerCookie = (await login(app, "viewer@lootpat.test")).cookie;

  const coupon = await call(app, "POST", "/api/admin/coupons", {
    cookie: ownerCookie,
    body: { code: "EID25", kind: "percent", value: 25, minSubtotalPaisa: 50000 },
  });
  assert.equal(coupon.status, 201, JSON.stringify(coupon.json));
  assert.equal(coupon.json.coupon.status, "active");

  const duplicate = await call(app, "POST", "/api/admin/coupons", {
    cookie: ownerCookie,
    body: { code: "EID25", kind: "percent", value: 10 },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.json.error, "code_taken");

  const viewerWrite = await call(app, "POST", "/api/admin/coupons", {
    cookie: viewerCookie,
    body: { code: "VIEWER10", kind: "percent", value: 10 },
  });
  assert.equal(viewerWrite.status, 403);

  const deactivated = await call(app, "PATCH", `/api/admin/coupons/${coupon.json.coupon.id}`, {
    cookie: ownerCookie,
    body: { active: false },
  });
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.json.coupon.status, "inactive");

  const campaign = await call(app, "POST", "/api/admin/campaigns", {
    cookie: ownerCookie,
    body: {
      channel: "sms",
      body: "ঈদ অফার চলছে — আজই অর্ডার করুন।",
      audience: "all",
      send: false,
    },
  });
  assert.equal(campaign.status, 201, JSON.stringify(campaign.json));
  assert.equal(campaign.json.campaign.status, "draft");
  assert.equal(campaign.json.campaign.recipients, 0);

  const sent = await call(app, "POST", "/api/admin/campaigns", {
    cookie: ownerCookie,
    body: {
      channel: "email",
      subject: "Eid campaign",
      body: "ঈদ অফার চলছে — আজই অর্ডার করুন।",
      audience: "vip",
      send: true,
    },
  });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  assert.equal(sent.json.campaign.status, "sent");
  assert.equal(sent.json.delivery.smsSent, 0);
  assert.ok(sent.json.delivery.emailSkipped >= 0);

  const audit = await call(app, "GET", "/api/admin/audit", { cookie: ownerCookie });
  const actions = audit.json.entries.map((entry) => entry.action);
  assert.ok(actions.includes("marketing.coupon.create"));
  assert.ok(actions.includes("marketing.coupon.update"));
  assert.ok(actions.includes("marketing.campaign.create"));
});

test("customer segments derive from orders and a block stops checkout", async () => {
  const { db, app, ownerCookie } = await marketingApp();

  await deliveredOrder(app, ownerCookie);

  const list = await call(app, "GET", "/api/admin/customers", { cookie: ownerCookie });
  assert.equal(list.status, 200);
  assert.equal(list.json.counts.all, 1);
  const customer = list.json.customers[0];
  assert.equal(customer.phone, "+8801712345678");
  assert.ok(customer.lifetimePaisa > 0);
  assert.equal(customer.segment, "new");

  const note = await call(app, "PATCH", `/api/admin/customers/${encodeURIComponent(customer.phone)}`, {
    cookie: ownerCookie,
    body: { action: "note", note: "মোবাইলে যোগাযোগ করা হয়েছে।" },
  });
  assert.equal(note.status, 201);

  const blocked = await call(app, "PATCH", `/api/admin/customers/${encodeURIComponent(customer.phone)}`, {
    cookie: ownerCookie,
    body: { action: "block", reason: "Repeated fake orders" },
  });
  assert.equal(blocked.status, 200);
  assert.equal(blocked.json.blocked, true);

  const refused = await call(app, "POST", "/api/orders", { body: orderBody() });
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error, "customer_blocked");

  const detail = await call(app, "GET", `/api/admin/customers/${encodeURIComponent(customer.phone)}`, {
    cookie: ownerCookie,
  });
  assert.equal(detail.status, 200);
  assert.equal(detail.json.customer.notes.length, 1);
  assert.equal(detail.json.customer.blockReason, "Repeated fake orders");

  const unblocked = await call(app, "PATCH", `/api/admin/customers/${encodeURIComponent(customer.phone)}`, {
    cookie: ownerCookie,
    body: { action: "unblock" },
  });
  assert.equal(unblocked.status, 200);
  assert.equal(unblocked.json.blocked, false);

  const accepted = await call(app, "POST", "/api/orders", { body: orderBody() });
  assert.equal(accepted.status, 201);
  assert.equal(db.dump("customer_notes").length, 1);
});

test("unsubscribe suppresses a contact and stock alerts record real interest", async () => {
  const { db, app } = await marketingApp();

  const unsubscribed = await call(app, "POST", "/api/marketing/unsubscribe", {
    body: { contact: "01712345678" },
  });
  assert.equal(unsubscribed.status, 200);
  assert.ok(db.dump("marketing_suppressions").some((row) => row.contact === "+8801712345678"));

  const alert = await call(app, "POST", "/api/marketing/back-in-stock", {
    body: { productId: MUG.id, phone: "01812345678" },
  });
  assert.equal(alert.status, 200);
  assert.equal(alert.json.available, true, "in-stock products answer immediately");

  const reminder = await call(app, "POST", "/api/marketing/cart-reminder", {
    body: { phone: "01812345678", itemCount: 2, consent: true },
  });
  assert.equal(reminder.status, 201);
  assert.equal(db.dump("cart_reminders").length, 1);

  const noConsent = await call(app, "POST", "/api/marketing/cart-reminder", {
    body: { phone: "01812345678", itemCount: 2, consent: false },
  });
  assert.equal(noConsent.status, 400, "a reminder without consent is never accepted");
});
