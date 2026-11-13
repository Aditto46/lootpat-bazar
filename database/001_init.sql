-- LootPat Bazar core schema (Step 2)
-- Apply through the Qoder Sites reviewed migration flow. Business DDL only;
-- role/permission and catalog rows are inserted by the protected seed route.

CREATE TABLE app.roles (
  id text PRIMARY KEY,
  name_bn text NOT NULL,
  name_en text NOT NULL,
  level integer NOT NULL,
  is_staff boolean NOT NULL DEFAULT true
);

CREATE TABLE app.permissions (
  id text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE app.role_permissions (
  role_id text NOT NULL REFERENCES app.roles (id) ON DELETE CASCADE,
  permission_id text NOT NULL REFERENCES app.permissions (id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE app.users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text UNIQUE,
  phone text UNIQUE,
  role_id text NOT NULL REFERENCES app.roles (id),
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  password_iterations integer NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE INDEX users_role_id_idx ON app.users (role_id);
CREATE INDEX users_created_at_idx ON app.users (created_at);

-- Exactly one owner at a time. Ownership transfer must change the existing
-- owner's role before another account can claim it.
CREATE UNIQUE INDEX users_single_owner_idx ON app.users (role_id) WHERE role_id = 'owner';

-- Only a SHA-256 digest of the opaque session token is stored.
CREATE TABLE app.sessions (
  token_digest text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX sessions_user_id_idx ON app.sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON app.sessions (expires_at);

-- Fixed-window counters. The primary key gives an atomic claim on first use.
CREATE TABLE app.auth_limiter (
  key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL
);

CREATE TABLE app.districts (
  id text PRIMARY KEY,
  name_bn text NOT NULL,
  name_en text NOT NULL,
  division_bn text NOT NULL,
  division_en text NOT NULL,
  position integer NOT NULL
);

CREATE TABLE app.categories (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name_bn text NOT NULL,
  name_en text NOT NULL,
  blurb_bn text NOT NULL,
  blurb_en text NOT NULL,
  accent text NOT NULL,
  icon text NOT NULL,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.products (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  category_id text NOT NULL REFERENCES app.categories (id),
  name_bn text NOT NULL,
  name_en text NOT NULL,
  tagline_bn text NOT NULL,
  tagline_en text NOT NULL,
  description_bn text NOT NULL,
  description_en text NOT NULL,
  price_paisa integer NOT NULL CHECK (price_paisa > 0),
  compare_at_paisa integer CHECK (compare_at_paisa IS NULL OR compare_at_paisa >= price_paisa),
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  low_stock_threshold integer NOT NULL DEFAULT 5,
  rating_tenths integer NOT NULL DEFAULT 0 CHECK (rating_tenths BETWEEN 0 AND 50),
  reviews integer NOT NULL DEFAULT 0 CHECK (reviews >= 0),
  badge text CHECK (badge IN ('bestseller', 'new', 'limited')),
  image text NOT NULL,
  image_small text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  featured boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX products_category_id_idx ON app.products (category_id);
CREATE INDEX products_status_idx ON app.products (status);
CREATE INDEX products_price_idx ON app.products (price_paisa);

CREATE TABLE app.product_images (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES app.products (id) ON DELETE CASCADE,
  url text NOT NULL,
  alt_bn text NOT NULL,
  alt_en text NOT NULL,
  position integer NOT NULL DEFAULT 0
);

CREATE INDEX product_images_product_id_idx ON app.product_images (product_id);

CREATE TABLE app.product_variants (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES app.products (id) ON DELETE CASCADE,
  sku text NOT NULL UNIQUE,
  option_label_bn text NOT NULL,
  option_label_en text NOT NULL,
  price_paisa integer NOT NULL CHECK (price_paisa > 0),
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  position integer NOT NULL DEFAULT 0
);

CREATE INDEX product_variants_product_id_idx ON app.product_variants (product_id);
