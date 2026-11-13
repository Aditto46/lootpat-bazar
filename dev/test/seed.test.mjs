import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDb } from "./fake-db.mjs";
import { call, makeApp } from "./helpers.mjs";
import { seedBaseline } from "../../functions/seed.mjs";
import { CATEGORIES } from "../../functions/seed-data/categories.mjs";
import { PRODUCTS } from "../../functions/seed-data/products.mjs";
import { DISTRICTS } from "../../functions/seed-data/districts.mjs";

test("seed data has the required shape", () => {
  assert.equal(CATEGORIES.length, 6);
  assert.equal(PRODUCTS.length, 20);
  assert.equal(DISTRICTS.length, 64);

  const divisions = new Set(DISTRICTS.map((district) => district.division_en));
  assert.equal(divisions.size, 8);
  for (const division of ["Dhaka", "Chattogram", "Rajshahi", "Khulna", "Barishal", "Sylhet", "Rangpur", "Mymensingh"]) {
    assert.ok(divisions.has(division), `missing division ${division}`);
  }

  assert.equal(new Set(PRODUCTS.map((product) => product.slug)).size, 20);
  assert.equal(new Set(PRODUCTS.map((product) => product.category_id)).size, 6);
  assert.ok(PRODUCTS.every((product) => Number.isInteger(product.price_paisa) && product.price_paisa > 0));
  assert.ok(PRODUCTS.every((product) => product.image.startsWith("/products/")));
});

test("baseline seed is idempotent", async () => {
  const db = createFakeDb();
  const first = await seedBaseline(db);
  const byTable = Object.fromEntries(first.map((entry) => [entry.table, entry]));

  assert.equal(byTable.roles.inserted, 6);
  assert.equal(byTable.permissions.inserted, 24);
  assert.equal(byTable.categories.inserted, 6);
  assert.equal(byTable.districts.inserted, 64);
  assert.equal(byTable.products.inserted, 20);
  assert.ok(byTable.role_permissions.inserted > 0);
  assert.equal(first.every((entry) => entry.existing === 0), true);

  const second = await seedBaseline(db);
  assert.equal(second.every((entry) => entry.inserted === 0), true);
  assert.equal(db.dump("products").length, 20);
  assert.equal(db.dump("districts").length, 64);
  assert.equal(db.dump("categories").length, 6);
});

test("public catalog endpoints read the seeded database", async () => {
  const db = createFakeDb();
  await seedBaseline(db);
  const app = makeApp(db);

  const categories = await call(app, "GET", "/api/catalog/categories");
  assert.equal(categories.status, 200);
  assert.deepEqual(categories.json.categories.map((row) => row.id), [
    "audio",
    "wearables",
    "bags",
    "home",
    "beauty",
    "gadgets",
  ]);

  const products = await call(app, "GET", "/api/catalog/products");
  assert.equal(products.status, 200);
  assert.equal(products.json.products.length, 20);
  const first = products.json.products[0];
  assert.ok(Number.isInteger(first.pricePaisa));
  assert.equal(first.rating, 4.9);
  assert.equal(first.slug, "nomad-leather-backpack");

  const featured = await call(app, "GET", "/api/catalog/products?featured=true");
  assert.equal(featured.json.products.length, 7);

  const search = await call(app, "GET", `/api/catalog/products?q=${encodeURIComponent("ইয়ারবাডস")}`);
  assert.equal(search.json.products.length, 2);

  const category = await call(app, "GET", "/api/catalog/products?category=beauty");
  assert.equal(category.json.products.length, 3);

  const detail = await call(app, "GET", "/api/catalog/products/pulse-x2-smartwatch");
  assert.equal(detail.status, 200);
  assert.equal(detail.json.product.stock, 3);
  assert.equal(detail.json.product.name.bn, "পালস এক্স২ স্মার্টওয়াচ");

  const missing = await call(app, "GET", "/api/catalog/products/no-such-product");
  assert.equal(missing.status, 404);

  const districts = await call(app, "GET", "/api/locations/districts");
  assert.equal(districts.json.districts.length, 64);
  assert.equal(districts.json.districts[0].id, "dhaka");
  assert.equal(districts.json.districts[63].id, "netrokona");
});
