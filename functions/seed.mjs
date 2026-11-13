// Idempotent baseline seed. Every row is inserted with a conflict target on its
// natural key, so running setup twice reports existing rows instead of failing
// or creating duplicates.
import { rows } from "./http.mjs";
import { PERMISSIONS, ROLES, ROLE_PERMISSIONS } from "./seed-data/rbac.mjs";
import { CATEGORIES } from "./seed-data/categories.mjs";
import { PRODUCTS } from "./seed-data/products.mjs";
import { VARIANTS, assertVariantStockMatchesProducts } from "./seed-data/variants.mjs";
import { DISTRICTS } from "./seed-data/districts.mjs";
import { COUPONS, SETTINGS } from "./seed-data/store.mjs";
import { CANNED_REPLIES, FAQ_ENTRIES } from "./seed-data/support.mjs";
import {
  BANNERS,
  BIRTHDAY_COUPON,
  DEMO_REVIEWS,
  MARKETING_SETTINGS,
  SPIN_PRIZES,
  flashSaleSeed,
} from "./seed-data/marketing.mjs";

async function insertMissing(db, table, records, { onConflict, columns }) {
  let inserted = 0;
  for (const record of records) {
    const result = rows(
      await db.from(table).insertIfAbsent(record, { onConflict }).select(columns),
    );
    if (result.length === 1) inserted += 1;
  }
  return { table, total: records.length, inserted, existing: records.length - inserted };
}

function assertSeedShape() {
  if (CATEGORIES.length !== 6) throw new Error("seed: expected 6 categories");
  if (PRODUCTS.length !== 20) throw new Error("seed: expected 20 products");
  if (DISTRICTS.length !== 64) throw new Error("seed: expected 64 districts");
  if (FAQ_ENTRIES.length !== 10) throw new Error("seed: expected 10 FAQ entries");
  if (CANNED_REPLIES.length !== 6) throw new Error("seed: expected 6 canned replies");
  if (SPIN_PRIZES.length < 3) throw new Error("seed: expected at least 3 spin prizes");
  if (DEMO_REVIEWS.length < 3) throw new Error("seed: expected at least 3 demo reviews");
  if (SPIN_PRIZES.reduce((total, prize) => total + prize.weight, 0) !== 100) {
    throw new Error("seed: spin prize weights must sum to 100");
  }
  if (new Set(FAQ_ENTRIES.map((entry) => entry.id)).size !== FAQ_ENTRIES.length) {
    throw new Error("seed: duplicate FAQ id");
  }
  if (new Set(CANNED_REPLIES.map((entry) => entry.id)).size !== CANNED_REPLIES.length) {
    throw new Error("seed: duplicate canned reply id");
  }
  assertVariantStockMatchesProducts(VARIANTS, PRODUCTS);

  const roleIds = new Set(ROLES.map((role) => role.id));
  const permissionIds = new Set(PERMISSIONS.map((permission) => permission.id));
  const categoryIds = new Set(CATEGORIES.map((category) => category.id));

  for (const [roleId, granted] of Object.entries(ROLE_PERMISSIONS)) {
    if (!roleIds.has(roleId)) throw new Error(`seed: unknown role ${roleId}`);
    for (const permissionId of granted) {
      if (!permissionIds.has(permissionId)) {
        throw new Error(`seed: unknown permission ${permissionId} on ${roleId}`);
      }
    }
  }
  for (const product of PRODUCTS) {
    if (!categoryIds.has(product.category_id)) {
      throw new Error(`seed: product ${product.slug} has an unknown category`);
    }
    if (product.price_paisa <= 0 || !Number.isInteger(product.price_paisa)) {
      throw new Error(`seed: product ${product.slug} has invalid price`);
    }
  }
}

export async function seedBaseline(db) {
  assertSeedShape();

  const permissions = PERMISSIONS.map(({ id, description }) => ({ id, description }));
  const roleGrants = Object.entries(ROLE_PERMISSIONS).flatMap(([role_id, granted]) =>
    granted.map((permission_id) => ({ role_id, permission_id })),
  );

  const summary = [];
  summary.push(await insertMissing(db, "roles", ROLES, { onConflict: "id", columns: "id" }));
  summary.push(
    await insertMissing(db, "permissions", permissions, { onConflict: "id", columns: "id" }),
  );
  summary.push(
    await insertMissing(db, "role_permissions", roleGrants, {
      onConflict: "role_id,permission_id",
      columns: "role_id",
    }),
  );
  summary.push(
    await insertMissing(db, "categories", CATEGORIES, { onConflict: "id", columns: "id" }),
  );
  summary.push(await insertMissing(db, "districts", DISTRICTS, { onConflict: "id", columns: "id" }));
  summary.push(await insertMissing(db, "products", PRODUCTS, { onConflict: "id", columns: "id" }));
  summary.push(
    await insertMissing(db, "product_variants", VARIANTS, { onConflict: "sku", columns: "sku" }),
  );
  summary.push(await insertMissing(db, "settings", SETTINGS, { onConflict: "key", columns: "key" }));
  summary.push(
    await insertMissing(db, "settings", MARKETING_SETTINGS, { onConflict: "key", columns: "key" }),
  );
  summary.push(await insertMissing(db, "coupons", COUPONS, { onConflict: "code", columns: "code" }));
  summary.push(
    await insertMissing(db, "coupons", [BIRTHDAY_COUPON], { onConflict: "code", columns: "code" }),
  );
  summary.push(
    await insertMissing(db, "spin_prizes", SPIN_PRIZES, { onConflict: "id", columns: "id" }),
  );
  summary.push(await insertMissing(db, "banners", BANNERS, { onConflict: "id", columns: "id" }));

  const sale = flashSaleSeed(PRODUCTS);
  summary.push(
    await insertMissing(db, "flash_sales", [sale.sale], { onConflict: "id", columns: "id" }),
  );
  summary.push(
    await insertMissing(db, "flash_sale_items", sale.items, {
      onConflict: "id",
      columns: "id",
    }),
  );
  summary.push(
    await insertMissing(db, "reviews", DEMO_REVIEWS, { onConflict: "id", columns: "id" }),
  );

  const now = new Date().toISOString();
  summary.push(
    await insertMissing(
      db,
      "faq_entries",
      FAQ_ENTRIES.map((entry) => ({
        ...entry,
        keywords: entry.keywords,
        published: true,
        created_at: now,
      })),
      { onConflict: "id", columns: "id" },
    ),
  );
  summary.push(
    await insertMissing(
      db,
      "support_canned_replies",
      CANNED_REPLIES.map((entry) => ({ ...entry, created_by: null, created_at: now })),
      { onConflict: "id", columns: "id" },
    ),
  );

  return summary;
}
