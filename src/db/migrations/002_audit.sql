CREATE TABLE entitlement_audit (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_id TEXT,
  source TEXT NOT NULL,
  previous_state JSONB,
  next_state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX entitlement_audit_user_idx ON entitlement_audit (user_id, created_at, id);
