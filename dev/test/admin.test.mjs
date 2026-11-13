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

async function ownerApp() {
  const db = createFakeDb();
  await seedBaseline(db);
  const app = makeApp(db);
  await setupWithOwner(app);
  const owner = await login(app, "owner@lootpat.test");
  assert.equal(owner.status, 200);
  return { db, app, ownerCookie: owner.cookie };
}

async function addStaff(app, ownerCookie, role, email) {
  const created = await call(app, "POST", "/api/admin/team", {
    cookie: ownerCookie,
    body: { name: `Test ${role}`, email, password: PASSWORD, role },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const session = await login(app, email);
  assert.equal(session.status, 200);
  return session.cookie;
}

function orderBody(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function productPayload(overrides = {}) {
  return {
    nameBn: "টেস্ট ক্যানভাস ব্যাগ",
    nameEn: "Test Canvas Bag",
    categoryId: "bags",
    brand: "LootPat Bazar",
    taglineBn: "প্রতিদিনের জন্য টেকসই ব্যাগ",
    taglineEn: "A durable bag for every day",
    descriptionBn: "মোটা ক্যানভাস, ভেতরে ল্যাপটপ পকেট।",
    descriptionEn: "Heavy canvas with an inside laptop pocket.",
    pricePaisa: 120000,
    compareAtPaisa: 150000,
    lowStockThreshold: 2,
    badge: "new",
    image: "/products/backpack-900.webp",
    imageSmall: "/products/backpack-450.webp",
    featured: false,
    status: "active",
    variants: [
      { sku: "TCB-BLK", optionType: "color", labelEn: "Black", labelBn: "কালো", pricePaisa: 120000, stock: 4, swatch: "#14151B" },
      { sku: "TCB-OLV", optionType: "color", labelEn: "Olive", labelBn: "অলিভ", pricePaisa: 125000, stock: 3, swatch: "#6B7A4F" },
      { sku: "TCB-SND", optionType: "color", labelEn: "Sand", labelBn: "স্যান্ড", pricePaisa: 125000, stock: 2, swatch: "#D8C3A5" },
    ],
    ...overrides,
  };
}

function stockOf(db, table, id) {
  return db.dump(table).find((row) => row.id === id).stock;
}

test("admin routes need a staff session and the exact permission", async () => {
  const { app } = await ownerApp();
  const viewer = await addStaff(app, (await login(app, "owner@lootpat.test")).cookie, "viewer", "viewer@lootpat.test");

  const anonymous = await call(app, "GET", "/api/admin/dashboard");
  assert.equal(anonymous.status, 401);

  const customer = await call(app, "POST", "/api/auth/register", {
    body: { name: "Kamal Hossain", phone: "01812345678", password: PASSWORD },
    ip: "198.51.100.201",
  });
  assert.equal(customer.status, 201);
  const customerDashboard = await call(app, "GET", "/api/admin/dashboard", {
    cookie: customer.cookie,
  });
  assert.equal(customerDashboard.status, 403);

  const viewerDashboard = await call(app, "GET", "/api/admin/dashboard", { cookie: viewer });
  assert.equal(viewerDashboard.status, 200);
  const viewerOrders = await call(app, "GET", "/api/admin/orders", { cookie: viewer });
  assert.equal(viewerOrders.status, 200);
  const viewerCreate = await call(app, "POST", "/api/admin/products", {
    cookie: viewer,
    body: productPayload(),
  });
  assert.equal(viewerCreate.status, 403);
  const viewerAudit = await call(app, "GET", "/api/admin/audit", { cookie: viewer });
  assert.equal(viewerAudit.status, 403);
});

test("owner creates a product with three variants and it reaches the catalog", async () => {
  const { db, app, ownerCookie } = await ownerApp();
  const created = await call(app, "POST", "/api/admin/products", {
    cookie: ownerCookie,
    body: productPayload(),
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const product = created.json.product;
  assert.equal(product.slug, "test-canvas-bag");
  assert.equal(product.variants.length, 3);
  assert.equal(product.stock, 9);
  assert.equal(product.status, "active");

  const catalog = await call(app, "GET", "/api/catalog/products?q=canvas");
  assert.equal(catalog.status, 200);
  assert.equal(catalog.json.products.length, 1);
  assert.equal(catalog.json.products[0].slug, "test-canvas-bag");

  const listed = await call(app, "GET", "/api/admin/products?q=canvas", { cookie: ownerCookie });
  assert.equal(listed.status, 200);
  assert.equal(listed.json.products.length, 1);

  const audit = await call(app, "GET", "/api/admin/audit", { cookie: ownerCookie });
  assert.equal(audit.status, 200);
  const entry = audit.json.entries.find((row) => row.action === "product.create");
  assert.ok(entry, "product.create is audited");
  assert.equal(entry.entityId, product.id);
  assert.equal(entry.details.variants, 3);
  assert.equal(entry.actor.role, "owner");

  const duplicateSlug = await call(app, "POST", "/api/admin/products", {
    cookie: ownerCookie,
    body: productPayload({ nameEn: "Test Canvas Bag" }),
  });
  assert.equal(duplicateSlug.status, 409);
  assert.equal(duplicateSlug.json.error, "slug_taken");

  const duplicateSku = await call(app, "POST", "/api/admin/products", {
    cookie: ownerCookie,
    body: productPayload({
      nameEn: "Another Canvas Tote",
      variants: [
        { sku: "TCB-BLK", optionType: "color", labelEn: "Black", labelBn: "কালো", pricePaisa: 120000, stock: 1 },
      ],
    }),
  });
  assert.equal(duplicateSku.status, 409);
  assert.equal(duplicateSku.json.error, "sku_taken");

  const badPrice = await call(app, "POST", "/api/admin/products", {
    cookie: ownerCookie,
    body: productPayload({ nameEn: "Bad Price Bag", compareAtPaisa: 1 }),
  });
  assert.equal(badPrice.status, 400);

  const stored = db.dump("products").find((row) => row.id === product.id);
  assert.equal(stored.stock, 9);
  assert.equal(db.dump("product_variants").filter((row) => row.product_id === product.id).length, 3);
});

test("editing a product updates variants and recomputes stock", async () => {
  const { app, ownerCookie } = await ownerApp();
  const created = await call(app, "POST", "/api/admin/products", {
    cookie: ownerCookie,
    body: productPayload(),
  });
  const product = created.json.product;

  const updated = await call(app, "PATCH", `/api/admin/products/${product.id}`, {
    cookie: ownerCookie,
    body: {
      nameEn: "Test Canvas Bag v2",
      pricePaisa: 130000,
      compareAtPaisa: 160000,
      variants: [
        { id: product.variants[0].id, sku: "TCB-BLK", optionType: "color", labelEn: "Black", labelBn: "কালো", pricePaisa: 130000, stock: 1 },
        { id: product.variants[1].id, sku: "TCB-OLV", optionType: "color", labelEn: "Olive", labelBn: "অলিভ", pricePaisa: 130000, stock: 1 },
        { id: product.variants[2].id, sku: "TCB-SND", optionType: "color", labelEn: "Sand", labelBn: "স্যান্ড", pricePaisa: 130000, stock: 1 },
        { sku: "TCB-NVY", optionType: "color", labelEn: "Navy", labelBn: "নেভি", pricePaisa: 130000, stock: 1, swatch: "#1F3059" },
      ],
    },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.json));
  assert.equal(updated.json.product.name.en, "Test Canvas Bag v2");
  assert.equal(updated.json.product.variants.length, 4);
  assert.equal(updated.json.product.stock, 4);

  const badCompare = await call(app, "PATCH", `/api/admin/products/${product.id}`, {
    cookie: ownerCookie,
    body: { pricePaisa: 200000 },
  });
  assert.equal(badCompare.status, 409);
  assert.equal(badCompare.json.error, "compare_at_below_price");

  const audit = await call(app, "GET", "/api/admin/audit", { cookie: ownerCookie });
  const entry = audit.json.entries.find((row) => row.action === "product.update");
  assert.ok(entry);
  assert.equal(entry.details.variants, 4);
});

test("adding a variant without a SKU never clashes with its siblings", async () => {
  const { app, ownerCookie } = await ownerApp();
  const payload = productPayload({
    variants: [
      { optionType: "color", labelEn: "Black", labelBn: "কালো", pricePaisa: 120000, stock: 2 },
      { optionType: "color", labelEn: "Olive", labelBn: "অলিভ", pricePaisa: 120000, stock: 2 },
      { optionType: "color", labelEn: "Sand", labelBn: "স্যান্ড", pricePaisa: 120000, stock: 2 },
    ],
  });
  const created = await call(app, "POST", "/api/admin/products", {
    cookie: ownerCookie,
    body: payload,
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const product = created.json.product;

  const updated = await call(app, "PATCH", `/api/admin/products/${product.id}`, {
    cookie: ownerCookie,
    body: {
      variants: [
        ...product.variants.map((variant) => ({
          id: variant.id,
          optionType: "color",
          labelEn: variant.label.en,
          labelBn: variant.label.bn,
          pricePaisa: variant.pricePaisa,
          stock: variant.stock,
        })),
        { optionType: "color", labelEn: "Navy", labelBn: "নেভি", pricePaisa: 130000, stock: 3 },
      ],
    },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.json));
  assert.equal(updated.json.product.variants.length, 4);
  const skus = updated.json.product.variants.map((variant) => variant.sku);
  assert.equal(new Set(skus).size, 4);
  assert.equal(updated.json.product.stock, 9);
});

test("bulk import skips bad and duplicate rows and drafts stay out of the catalog", async () => {
  const { app, ownerCookie } = await ownerApp();
  const imported = await call(app, "POST", "/api/admin/products/import", {
    cookie: ownerCookie,
    body: {
      rows: [
        {
          nameEn: "Import Desk Lamp",
          nameBn: "ইমপোর্ট ডেস্ক ল্যাম্প",
          categoryId: "home",
          pricePaisa: 45000,
          stock: 6,
          badge: "new",
          image: "/products/charger-900.webp",
        },
        {
          nameEn: "Import Desk Lamp",
          nameBn: "ডুপ্লিকেট",
          categoryId: "home",
          pricePaisa: 45000,
        },
        {
          nameEn: "Import Glass Bottle",
          nameBn: "ইমপোর্ট বোতল",
          categoryId: "home",
          pricePaisa: 18000,
          stock: 3,
          sku: "IGB-500",
          variantLabelEn: "500 ml",
          variantLabelBn: "৫০০ মিলি",
          variantStock: 3,
        },
        { nameEn: "Broken Row", nameBn: "ভুল", categoryId: "home", pricePaisa: 1 },
        { nameEn: "Unknown Category", nameBn: "ভুল", categoryId: "nope", pricePaisa: 9000 },
      ],
    },
  });
  assert.equal(imported.status, 200, JSON.stringify(imported.json));
  assert.equal(imported.json.created, 2);
  assert.equal(imported.json.skipped.length, 3);
  assert.deepEqual(
    imported.json.skipped.map((row) => row.reason).sort(),
    ["category_unknown", "invalid_row", "slug_exists"],
  );

  const catalog = await call(app, "GET", "/api/catalog/products?q=import");
  assert.equal(catalog.status, 200);
  assert.equal(catalog.json.products.length, 0, "draft imports are not published");

  const published = await call(app, "POST", "/api/admin/products/import", {
    cookie: ownerCookie,
    body: {
      publish: true,
      rows: [
        {
          nameEn: "Import Steel Bottle",
          nameBn: "ইমপোর্ট স্টিল বোতল",
          categoryId: "home",
          pricePaisa: 32000,
          stock: 5,
        },
      ],
    },
  });
  assert.equal(published.json.created, 1);
  const live = await call(app, "GET", "/api/catalog/products?q=steel");
  assert.equal(live.json.products.length, 1);

  const audit = await call(app, "GET", "/api/admin/audit", { cookie: ownerCookie });
  const entry = audit.json.entries.find((row) => row.action === "product.import");
  assert.ok(entry);
  assert.equal(entry.details.created, 1);
});

test("order kanban enforces transitions, restocks cancellations and audits each move", async () => {
  const { db, app, ownerCookie } = await ownerApp();
  const created = await call(app, "POST", "/api/orders", {
    body: orderBody(),
    ip: "198.51.100.211",
  });
  assert.equal(created.status, 201);
  const orderNumber = created.json.order.orderNumber;

  const listed = await call(app, "GET", `/api/admin/orders?status=pending&q=01712345678`, {
    cookie: ownerCookie,
  });
  assert.equal(listed.status, 200);
  assert.equal(listed.json.orders.length, 1);
  assert.equal(listed.json.orders[0].itemCount, 1);
  assert.equal(listed.json.counts.pending, 1);

  const skippedStep = await call(app, "PATCH", `/api/admin/orders/${orderNumber}/status`, {
    cookie: ownerCookie,
    body: { status: "delivered" },
  });
  assert.equal(skippedStep.status, 409);
  assert.equal(skippedStep.json.error, "invalid_transition");

  for (const status of ["confirmed", "packed", "shipped", "delivered"]) {
    const moved = await call(app, "PATCH", `/api/admin/orders/${orderNumber}/status`, {
      cookie: ownerCookie,
      body: { status, note: "handled in test" },
    });
    assert.equal(moved.status, 200, `${status}: ${JSON.stringify(moved.json)}`);
    assert.equal(moved.json.order.status, status);
  }
  const delivered = await call(app, "GET", `/api/admin/orders/${orderNumber}`, {
    cookie: ownerCookie,
  });
  assert.equal(delivered.json.order.paymentStatus, "paid", "COD is collected on delivery");
  assert.deepEqual(delivered.json.order.statusHistory.map((row) => row.status), [
    "pending",
    "confirmed",
    "packed",
    "shipped",
    "delivered",
  ]);

  const productBefore = stockOf(db, "products", MUG.id);
  const variantBefore = stockOf(db, "product_variants", MUG_STONE.id);
  const returned = await call(app, "PATCH", `/api/admin/orders/${orderNumber}/status`, {
    cookie: ownerCookie,
    body: { status: "returned" },
  });
  assert.equal(returned.status, 200);
  assert.equal(stockOf(db, "products", MUG.id), productBefore + 2);
  assert.equal(stockOf(db, "product_variants", MUG_STONE.id), variantBefore + 2);

  const reopened = await call(app, "PATCH", `/api/admin/orders/${orderNumber}/status`, {
    cookie: ownerCookie,
    body: { status: "confirmed" },
  });
  assert.equal(reopened.status, 409);

  const audit = await call(app, "GET", "/api/admin/audit", { cookie: ownerCookie });
  const moves = audit.json.entries.filter(
    (row) => row.action === "order.status" && row.entityId === orderNumber,
  );
  assert.equal(moves.length, 5);
  const deliveredEntry = moves.find((row) => row.details.to === "delivered");
  assert.equal(deliveredEntry.details.paymentStatus, "paid");
});

test("cancelling a pending order restocks it exactly once", async () => {
  const { db, app, ownerCookie } = await ownerApp();
  const beforeProduct = stockOf(db, "products", MUG.id);
  const beforeVariant = stockOf(db, "product_variants", MUG_STONE.id);
  const created = await call(app, "POST", "/api/orders", {
    body: orderBody({ customer: { ...orderBody().customer, phone: "01712345679" } }),
    ip: "198.51.100.212",
  });
  assert.equal(created.status, 201);
  assert.equal(stockOf(db, "products", MUG.id), beforeProduct - 2);

  const cancelled = await call(
    app,
    "PATCH",
    `/api/admin/orders/${created.json.order.orderNumber}/status`,
    { cookie: ownerCookie, body: { status: "cancelled" } },
  );
  assert.equal(cancelled.status, 200);
  assert.deepEqual(cancelled.json.restock, { restored: 2, failed: 0 });
  assert.equal(stockOf(db, "products", MUG.id), beforeProduct);
  assert.equal(stockOf(db, "product_variants", MUG_STONE.id), beforeVariant);
});

test("payment overrides and archiving stay owner-only", async () => {
  const { app, ownerCookie } = await ownerApp();
  const manager = await addStaff(app, ownerCookie, "manager", "manager@lootpat.test");
  const created = await call(app, "POST", "/api/orders", {
    body: orderBody({ customer: { ...orderBody().customer, phone: "01712345680" } }),
    ip: "198.51.100.213",
  });
  const orderNumber = created.json.order.orderNumber;

  const managerPayment = await call(app, "PATCH", `/api/admin/orders/${orderNumber}/payment`, {
    cookie: manager,
    body: { paymentStatus: "paid" },
  });
  assert.equal(managerPayment.status, 403);

  const ownerPayment = await call(app, "PATCH", `/api/admin/orders/${orderNumber}/payment`, {
    cookie: ownerCookie,
    body: { paymentStatus: "refunded", note: "test refund" },
  });
  assert.equal(ownerPayment.status, 200);
  assert.equal(ownerPayment.json.order.paymentStatus, "refunded");

  const product = await call(app, "POST", "/api/admin/products", {
    cookie: ownerCookie,
    body: productPayload({ nameEn: "Archive Me Bag", slug: "archive-me-bag" }),
  });
  assert.equal(product.status, 201);

  const managerArchive = await call(
    app,
    "POST",
    `/api/admin/products/${product.json.product.id}/archive`,
    { cookie: manager },
  );
  assert.equal(managerArchive.status, 403);

  const ownerArchive = await call(
    app,
    "POST",
    `/api/admin/products/${product.json.product.id}/archive`,
    { cookie: ownerCookie },
  );
  assert.equal(ownerArchive.status, 200);

  const list = await call(app, "GET", "/api/admin/products?q=archive", { cookie: ownerCookie });
  assert.equal(list.json.products.length, 0);
  const detail = await call(app, "GET", `/api/admin/products/${product.json.product.id}`, {
    cookie: ownerCookie,
  });
  assert.equal(detail.status, 404);

  const audit = await call(app, "GET", "/api/admin/audit", { cookie: ownerCookie });
  assert.ok(audit.json.entries.some((row) => row.action === "product.archive"));
  assert.ok(audit.json.entries.some((row) => row.action === "order.payment"));
});

test("dashboard reports today's orders, open work and low stock", async () => {
  const { db, app, ownerCookie } = await ownerApp();
  const created = await call(app, "POST", "/api/orders", {
    body: orderBody({ customer: { ...orderBody().customer, phone: "01712345681" } }),
    ip: "198.51.100.214",
  });
  assert.equal(created.status, 201);

  const low = db.dump("products").find((row) => row.slug === MUG.slug);
  await db
    .from("products")
    .update({ stock: 1 })
    .eq("id", low.id)
    .select("id");

  const dashboard = await call(app, "GET", "/api/admin/dashboard", { cookie: ownerCookie });
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.json.metrics.todayOrders, 1);
  assert.equal(dashboard.json.metrics.todayRevenuePaisa, created.json.order.totals.totalPaisa);
  assert.equal(dashboard.json.metrics.openOrders, 1);
  assert.ok(dashboard.json.metrics.lowStockCount >= 1);
  assert.equal(dashboard.json.metrics.activeProducts, 20);
  assert.equal(dashboard.json.trend.length, 7);
  assert.equal(dashboard.json.recentOrders[0].orderNumber, created.json.order.orderNumber);
  assert.ok(dashboard.json.lowStock.some((row) => row.slug === MUG.slug));
});
