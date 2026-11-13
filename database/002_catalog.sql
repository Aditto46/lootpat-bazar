-- Step 3 — catalog browsing: brand facet and typed product variants.
-- Safe to apply on a database that already ran 001_init.sql.

ALTER TABLE app.products
  ADD COLUMN brand text NOT NULL DEFAULT 'LootPat Bazar';

CREATE INDEX products_brand_idx ON app.products (brand);

ALTER TABLE app.product_variants
  ADD COLUMN option_type text NOT NULL DEFAULT 'color'
    CHECK (option_type IN ('color', 'size')),
  ADD COLUMN swatch text;

CREATE INDEX product_variants_option_type_idx ON app.product_variants (option_type);
