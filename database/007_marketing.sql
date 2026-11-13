-- Step 8 — marketing, reviews and customer segments.
-- Photo reviews are moderated before they count; a review is tied to a real
-- delivered order for the same phone, so "verified buyer" means something.
-- Spin rewards become ordinary coupons with a one-use limit, and loyalty points
-- live in an append-only ledger keyed by phone so guest orders still earn.
--
-- Run after 006_support.sql.

-- birth_date (text) and marketing_opt_out live in 001_init.sql.

CREATE TABLE app.reviews (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES app.products (id) ON DELETE CASCADE,
  order_id uuid REFERENCES app.orders (id) ON DELETE SET NULL,
  order_number text NOT NULL,
  user_id uuid REFERENCES app.users (id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  phone text NOT NULL,
  rating integer NOT NULL,
  title text,
  body text NOT NULL,
  photo_urls text NOT NULL DEFAULT '[]',
  verified_purchase boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',
  helpful_count integer NOT NULL DEFAULT 0,
  reply_body text,
  replied_at timestamptz,
  replied_by uuid REFERENCES app.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, product_id)
);

CREATE INDEX reviews_product_status_idx ON app.reviews (product_id, status, created_at);
CREATE INDEX reviews_status_idx ON app.reviews (status, created_at);

CREATE TABLE app.review_votes (
  review_id uuid NOT NULL REFERENCES app.reviews (id) ON DELETE CASCADE,
  voter_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, voter_key)
);

-- Sales and banners use text ids because the demo seed ships fixed slugs.
CREATE TABLE app.flash_sales (
  id text PRIMARY KEY,
  title_bn text NOT NULL,
  title_en text NOT NULL,
  subtitle_bn text NOT NULL DEFAULT '',
  subtitle_en text NOT NULL DEFAULT '',
  discount_percent integer NOT NULL,
  banner_image text,
  status text NOT NULL DEFAULT 'draft',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX flash_sales_status_idx ON app.flash_sales (status, starts_at, ends_at);

CREATE TABLE app.flash_sale_items (
  id uuid PRIMARY KEY,
  sale_id text NOT NULL REFERENCES app.flash_sales (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES app.products (id) ON DELETE CASCADE,
  sale_price_paisa integer NOT NULL,
  stock_limit integer,
  sold_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_id, product_id)
);

CREATE INDEX flash_sale_items_sale_idx ON app.flash_sale_items (sale_id);

CREATE TABLE app.spin_prizes (
  id text PRIMARY KEY,
  label_bn text NOT NULL,
  label_en text NOT NULL,
  kind text NOT NULL,
  value integer NOT NULL,
  weight integer NOT NULL DEFAULT 10,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One spin per visitor. The unique visitor key makes a replay return the same
-- reward instead of minting a second coupon.
CREATE TABLE app.spin_results (
  id uuid PRIMARY KEY,
  visitor_key text NOT NULL UNIQUE,
  prize_id text NOT NULL REFERENCES app.spin_prizes (id),
  coupon_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.loyalty_ledger (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES app.users (id) ON DELETE SET NULL,
  phone text NOT NULL,
  points integer NOT NULL,
  reason text NOT NULL,
  order_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_number, reason)
);

CREATE INDEX loyalty_ledger_phone_idx ON app.loyalty_ledger (phone, created_at);

CREATE TABLE app.customer_blocks (
  phone text PRIMARY KEY,
  reason text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  blocked_by uuid REFERENCES app.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.customer_notes (
  id uuid PRIMARY KEY,
  phone text NOT NULL,
  body text NOT NULL,
  created_by uuid REFERENCES app.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customer_notes_phone_idx ON app.customer_notes (phone, created_at);

CREATE TABLE app.back_in_stock_alerts (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES app.products (id) ON DELETE CASCADE,
  phone text NOT NULL,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, phone)
);

CREATE INDEX back_in_stock_alerts_product_idx ON app.back_in_stock_alerts (product_id, notified_at);

CREATE TABLE app.campaigns (
  id uuid PRIMARY KEY,
  channel text NOT NULL,
  subject text NOT NULL DEFAULT '',
  body text NOT NULL,
  audience text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  recipients integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES app.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE TABLE app.banners (
  id text PRIMARY KEY,
  title_bn text NOT NULL,
  title_en text NOT NULL,
  body_bn text NOT NULL DEFAULT '',
  body_en text NOT NULL DEFAULT '',
  cta_label_bn text NOT NULL DEFAULT '',
  cta_label_en text NOT NULL DEFAULT '',
  href text NOT NULL DEFAULT '/shop',
  tone text NOT NULL DEFAULT 'teal',
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX banners_active_idx ON app.banners (active, sort_order);

CREATE TABLE app.cart_reminders (
  id uuid PRIMARY KEY,
  phone text NOT NULL,
  item_count integer NOT NULL,
  consent boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cart_reminders_phone_idx ON app.cart_reminders (phone, created_at);

-- Unsubscribed contacts are suppressed from every future campaign. Campaign
-- sends never read a suppressed contact, even if an older order still carries
-- marketing consent.
CREATE TABLE app.marketing_suppressions (
  contact text PRIMARY KEY,
  channel text NOT NULL DEFAULT 'all',
  created_at timestamptz NOT NULL DEFAULT now()
);
