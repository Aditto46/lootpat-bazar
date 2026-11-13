-- Step 5 — admin dashboard, product authoring and order fulfilment.
-- Audit rows are append-only by convention: no application route updates or
-- deletes them, and they survive the actor account being removed.

CREATE TABLE app.audit_logs (
  id uuid PRIMARY KEY,
  actor_user_id uuid REFERENCES app.users (id) ON DELETE SET NULL,
  actor_name text NOT NULL,
  actor_role text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  summary text NOT NULL,
  details text NOT NULL DEFAULT '{}',
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_created_at_idx ON app.audit_logs (created_at);
CREATE INDEX audit_logs_actor_user_id_idx ON app.audit_logs (actor_user_id);
CREATE INDEX audit_logs_action_idx ON app.audit_logs (action);
CREATE INDEX audit_logs_entity_idx ON app.audit_logs (entity_type, entity_id);

-- The kanban groups by status and always shows the newest order first.
CREATE INDEX orders_status_created_idx ON app.orders (status, created_at);
