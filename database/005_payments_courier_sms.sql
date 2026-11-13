-- Step 6 — online payment sessions, verified provider events, courier handoff
-- and transactional SMS. Card data is never stored: a session keeps only the
-- provider reference returned by the gateway.
--
-- Run after 004_admin.sql.

-- Courier columns live in 003_orders.sql; only new indexes are declared here.
CREATE INDEX orders_phone_created_idx ON app.orders (phone, created_at);
CREATE INDEX orders_payment_status_idx ON app.orders (payment_status, created_at);

-- One row per checkout attempt. `sandbox_token` authorizes the local simulator;
-- it is never returned through an order or admin response.
CREATE TABLE app.payment_sessions (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES app.orders (id) ON DELETE CASCADE,
  provider text NOT NULL,
  amount_paisa integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  provider_ref text,
  redirect_url text,
  sandbox_token text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_sessions_order_idx ON app.payment_sessions (order_id, created_at);
CREATE INDEX payment_sessions_status_idx ON app.payment_sessions (status, expires_at);

-- Provider event ids are unique per provider, which makes replays harmless: the
-- second delivery loses the insert and is answered as a duplicate.
CREATE TABLE app.webhook_events (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  event_id text NOT NULL,
  order_id uuid REFERENCES app.orders (id) ON DELETE SET NULL,
  amount_paisa integer,
  outcome text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

CREATE INDEX webhook_events_order_idx ON app.webhook_events (order_id, created_at);

CREATE TABLE app.sms_log (
  id uuid PRIMARY KEY,
  order_id uuid REFERENCES app.orders (id) ON DELETE SET NULL,
  phone text NOT NULL,
  template text NOT NULL,
  message text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL,
  provider_ref text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sms_log_order_idx ON app.sms_log (order_id, created_at);
CREATE INDEX sms_log_phone_idx ON app.sms_log (phone, created_at);
