CREATE TABLE store_events (
  event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  event_time_ms BIGINT NOT NULL,
  product_id TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX store_events_user_time_idx ON store_events (user_id, event_time_ms, event_id);

CREATE TABLE carrier_state (
  user_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_polled_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX carrier_state_poll_idx ON carrier_state (last_polled_at NULLS FIRST);

CREATE TABLE marketplace_state (
  user_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_entitlements (
  user_id TEXT PRIMARY KEY,
  active BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'NONE',
  expires_at TIMESTAMPTZ,
  reason TEXT,
  last_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  target_expires_at TIMESTAMPTZ NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, type, target_expires_at)
);

CREATE INDEX notifications_due_idx ON notifications (scheduled_for) WHERE sent_at IS NULL;
