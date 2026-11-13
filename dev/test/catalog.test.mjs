import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDb } from "./fake-db.mjs";
import { call, makeApp } from "./helpers.mjs";
import { seedBaseline } from "../../functions/seed.mjs";
import { PRODUCTS } from "../../functions/seed-data/products.mjs";
import { VARIANTS } from "../../functions/seed-data/variants.mjs";

async function catalogApp() {
  const db = createFakeDb();
  await seedBaseline(db);
  return { db, app: makeApp(db) };
}

test("variants cover every product and split its stock exactly", () => {
  assert.equal(VARIANTS.length, 40);
  const totals = new Map();
  for (const variant of VARIANTS) {
    totals.set(variant.product_id, (totals.get(variant.product_id) ?? 0) + variant.stock);
    assert.ok(variant.price_paisa > 0);
    assert.ok(variant.sku.length > 0);
    assert.ok(["color", "size"].includes(variant.option_type));
  }
  for (const product of PRODUCTS) {
    assert.equal(totals.get(product.id), product.stock, product.slug);
  }
  assert.equal(new Set(VARIANTS.map((variant) => variant.sku)).size, VARIANTS.length);
});

test("catalog filters, sorts and exposes facets", async () => {
  const { app } = await catalogApp();

  const all = await call(app, "GET", "/api/catalog/products");
  assert.equal(all.status, 200);
  assert.equal(all.json.products.length, 20);
  assert.equal(all.json.total, 20);
  assert.ok(all.json.facets);
  assert.equal(all.json.facets.price.maxPaisa, 745000);
  assert.equal(
    all.json.facets.brands.find((brand) => brand.value === "AirBeat").count,
    2,
  );
  assert.ok(all.json.facets.colors.some((color) => color.value === "teal"));
  assert.ok(all.json.facets.sizes.some((size) => size.value === "50 ml"));

  const brand = await call(app, "GET", "/api/catalog/products?brand=AirBeat");
  assert.equal(brand.json.products.length, 2);
  assert.ok(brand.json.products.every((product) => product.brand === "AirBeat"));

  const price = await call(
    app,
    "GET",
    "/api/catalog/products?minPrice=100000&maxPrice=200000",
  );
  assert.ok(price.json.products.length > 0);
  assert.ok(price.json.products.every((product) => product.pricePaisa <= 200000));

  const rating = await call(app, "GET", "/api/catalog/products?rating=4.8");
  assert.ok(rating.json.products.every((product) => product.rating >= 4.8));

  const inStock = await call(app, "GET", "/api/catalog/products?inStock=true");
  assert.equal(inStock.json.products.length, 20);
  assert.ok(inStock.json.products.every((product) => product.stock > 0));

  const option = await call(app, "GET", "/api/catalog/products?option=teal");
  assert.equal(option.json.products.length, 4);
  assert.ok(
    option.json.products.every((product) =>
      product.variants.some((variant) => variant.label.en.toLowerCase() === "teal"),
    ),
  );

  const ascending = await call(app, "GET", "/api/catalog/products?sort=price-asc");
  const prices = ascending.json.products.map((product) => product.pricePaisa);
  assert.deepEqual(prices, [...prices].sort((left, right) => left - right));
  assert.equal(ascending.json.products[0].slug, "stone-ceramic-mug");

  const discount = await call(app, "GET", "/api/catalog/products?sort=discount-desc");
  assert.equal(discount.status, 200);

  const invalidRange = await call(
    app,
    "GET",
    "/api/catalog/products?minPrice=500000&maxPrice=100000",
  );
  assert.equal(invalidRange.status, 400);
  assert.equal(invalidRange.json.error, "invalid_input");

  const invalidSort = await call(app, "GET", "/api/catalog/products?sort=popular");
  assert.equal(invalidSort.status, 400);
});

test("search tolerates typos in both languages and folds Bengali digits", async () => {
  const { app } = await catalogApp();

  const english = await call(app, "GET", "/api/catalog/products?q=earbud");
  assert.equal(english.json.products.length, 2);

  const typo = await call(app, "GET", "/api/catalog/products?q=earbudz");
  assert.equal(typo.json.products.length, 2);

  const bengaliPrefix = await call(
    app,
    "GET",
    `/api/catalog/products?q=${encodeURIComponent("ইয়ারবাড")}`,
  );
  assert.equal(bengaliPrefix.json.products.length, 2);

  const bengaliTypo = await call(
    app,
    "GET",
    `/api/catalog/products?q=${encodeURIComponent("ইয়ারবাডস")}`,
  );
  assert.equal(bengaliTypo.json.products.length, 2);

  const digits = await call(app, "GET", "/api/catalog/products?q=65");
  assert.ok(digits.json.products.some((product) => product.slug === "gan-65w-charger"));

  const brandSearch = await call(app, "GET", "/api/catalog/products?q=nomad");
  assert.equal(brandSearch.json.products.length, 3);

  const nothing = await call(app, "GET", "/api/catalog/products?q=zzzzz");
  assert.equal(nothing.json.products.length, 0);
  assert.equal(nothing.json.total, 0);

  const combined = await call(
    app,
    "GET",
    `/api/catalog/products?q=${encodeURIComponent("ব্যাকপ্যাক")}&sort=price-asc`,
  );
  assert.equal(combined.json.products.length, 2);
  assert.equal(combined.json.products[0].slug, "nomad-city-backpack");
});

test("product detail returns ordered variants and real stock", async () => {
  const { app } = await catalogApp();

  const detail = await call(app, "GET", "/api/catalog/products/glow-vitamin-c-serum");
  assert.equal(detail.status, 200);
  assert.equal(detail.json.product.brand, "Aura");
  assert.equal(detail.json.product.variants.length, 2);
  assert.deepEqual(
    detail.json.product.variants.map((variant) => variant.label.en),
    ["30 ml", "50 ml"],
  );
  assert.equal(
    detail.json.product.variants.reduce((total, variant) => total + variant.stock, 0),
    detail.json.product.stock,
  );
  assert.equal(detail.json.product.variants[1].pricePaisa, 189000);

  const missing = await call(app, "GET", "/api/catalog/products/not-a-product");
  assert.equal(missing.status, 404);
});

test("search is rate limited per client address", async () => {
  const { app } = await catalogApp();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const allowed = await call(app, "GET", "/api/catalog/products?q=mug", { ip: "203.0.113.9" });
    assert.equal(allowed.status, 200);
  }
  const blocked = await call(app, "GET", "/api/catalog/products?q=mug", { ip: "203.0.113.9" });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error, "rate_limited");
  assert.ok(Number(blocked.headers.get("retry-after")) >= 1);

  const otherClient = await call(app, "GET", "/api/catalog/products?q=mug", {
    ip: "203.0.113.10",
  });
  assert.equal(otherClient.status, 200);
});
