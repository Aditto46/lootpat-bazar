-- Step 7 — live support chat: conversations double as tickets, with assignment,
-- an SLA deadline, canned replies and a human handoff. The customer holds an
-- opaque access token whose digest is stored here, so a conversation id alone
-- can never read another customer's chat.
--
-- Run after 005_payments_courier_sms.sql.

CREATE TABLE app.support_conversations (
  id uuid PRIMARY KEY,
  access_token_hash text NOT NULL UNIQUE,
  user_id uuid REFERENCES app.users (id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  customer_phone text,
  order_number text,
  locale text NOT NULL DEFAULT 'bn' CHECK (locale IN ('bn', 'en')),
  channel text NOT NULL DEFAULT 'web' CHECK (channel IN ('web')),
  status text NOT NULL DEFAULT 'bot'
    CHECK (status IN ('bot', 'waiting', 'open', 'resolved')),
  assigned_to uuid REFERENCES app.users (id) ON DELETE SET NULL,
  sla_due_at timestamptz,
  first_response_at timestamptz,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE INDEX support_conversations_status_idx ON app.support_conversations (status, last_message_at);
CREATE INDEX support_conversations_assigned_idx ON app.support_conversations (assigned_to, status);

CREATE TABLE app.support_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES app.support_conversations (id) ON DELETE CASCADE,
  author_type text NOT NULL
    CHECK (author_type IN ('customer', 'assistant', 'staff', 'system')),
  author_id uuid REFERENCES app.users (id) ON DELETE SET NULL,
  body text NOT NULL,
  intent text,
  handoff_suggested boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX support_messages_conversation_idx ON app.support_messages (conversation_id, created_at);

CREATE TABLE app.support_canned_replies (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  locale text NOT NULL DEFAULT 'bn' CHECK (locale IN ('bn', 'en')),
  position integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES app.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.faq_entries (
  id uuid PRIMARY KEY,
  question_bn text NOT NULL,
  question_en text NOT NULL,
  answer_bn text NOT NULL,
  answer_en text NOT NULL,
  keywords text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'general',
  position integer NOT NULL DEFAULT 0,
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX faq_entries_published_idx ON app.faq_entries (published, position);
