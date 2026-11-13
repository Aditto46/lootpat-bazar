-- Step 3 — catalog browsing: brand facet and typed product variants.
-- The columns live in 001_init.sql; this file only declares their indexes,
-- because the hosted migration subset cannot alter existing tables.

CREATE INDEX products_brand_idx ON app.products (brand);
CREATE INDEX product_variants_option_type_idx ON app.product_variants (option_type);
