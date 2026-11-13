-- Step 4 — cart checkout, COD orders, coupons and store delivery settings.
-- Safe to apply after 001_init.sql and 002_catalog.sql. Money stays in integer
-- paisa; every order row is a snapshot so later catalog edits cannot rewrite it.

CREATE TABLE app.settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.coupons (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  kind text NOT NULL,
  value integer NOT NULL DEFAULT 0,
  min_subtotal_paisa integer NOT NULL DEFAULT 0,
  max_discount_paisa integer,
  usage_limit integer,
  per_customer_limit integer,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX coupons_active_idx ON app.coupons (active);

CREATE TABLE app.orders (
  id uuid PRIMARY KEY,
  order_number text NOT NULL UNIQUE,
  lookup_token text NOT NULL,
  idempotency_key text UNIQUE,
  user_id uuid REFERENCES app.users (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  payment_method text NOT NULL,
  payment_status text NOT NULL DEFAULT 'unpaid',
  customer_name text NOT NULL,
  phone text NOT NULL,
  email text,
  district_id text NOT NULL REFERENCES app.districts (id),
  district_name_bn text NOT NULL,
  district_name_en text NOT NULL,
  division_name_bn text NOT NULL,
  division_name_en text NOT NULL,
  address text NOT NULL,
  area text,
  note text,
  subtotal_paisa integer NOT NULL,
  discount_paisa integer NOT NULL DEFAULT 0,
  shipping_paisa integer NOT NULL DEFAULT 0,
  total_paisa integer NOT NULL,
  coupon_code text,
  marketing_consent boolean NOT NULL DEFAULT false,
  ip text,
  user_agent text,
  courier text,
  tracking_number text,
  courier_status text,
  shipped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX orders_phone_idx ON app.orders (phone);
CREATE INDEX orders_status_idx ON app.orders (status);
CREATE INDEX orders_created_at_idx ON app.orders (created_at);
CREATE INDEX orders_user_id_idx ON app.orders (user_id);

CREATE TABLE app.order_items (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES app.orders (id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  product_id uuid NOT NULL REFERENCES app.products (id),
  product_slug text NOT NULL,
  variant_id uuid REFERENCES app.product_variants (id),
  sku text NOT NULL,
  name_bn text NOT NULL,
  name_en text NOT NULL,
  variant_label_bn text,
  variant_label_en text,
  unit_price_paisa integer NOT NULL,
  qty integer NOT NULL,
  line_total_paisa integer NOT NULL,
  image text NOT NULL
);

CREATE INDEX order_items_order_id_idx ON app.order_items (order_id);
CREATE INDEX order_items_product_id_idx ON app.order_items (product_id);

CREATE TABLE app.order_status_history (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES app.orders (id) ON DELETE CASCADE,
  status text NOT NULL,
  note text,
  actor_user_id uuid REFERENCES app.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_status_history_order_id_idx ON app.order_status_history (order_id);

CREATE TABLE app.payments (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES app.orders (id) ON DELETE CASCADE,
  method text NOT NULL,
  status text NOT NULL,
  amount_paisa integer NOT NULL,
  provider_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payments_order_id_idx ON app.payments (order_id);

CREATE TABLE app.coupon_redemptions (
  id uuid PRIMARY KEY,
  coupon_id text NOT NULL REFERENCES app.coupons (id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES app.orders (id) ON DELETE CASCADE,
  phone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coupon_id, order_id)
);

CREATE INDEX coupon_redemptions_coupon_id_idx ON app.coupon_redemptions (coupon_id);
CREATE INDEX coupon_redemptions_phone_idx ON app.coupon_redemptions (phone);
