ALTER TABLE identity.users ADD COLUMN active BOOLEAN NOT NULL DEFAULT true, ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE identity.sessions (
  id UUID PRIMARY KEY, "userId" UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL, "revokedAt" TIMESTAMPTZ(3)
);
CREATE INDEX sessions_userId_idx ON identity.sessions("userId");
CREATE TABLE identity.password_recoveries (
  "tokenHash" VARCHAR(64) PRIMARY KEY, "userId" UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX password_recoveries_userId_idx ON identity.password_recoveries("userId");
CREATE TABLE identity.recovery_messages (
  id UUID PRIMARY KEY, "userId" UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMPTZ(3)
);
CREATE INDEX recovery_messages_deliveredAt_availableAt_idx ON identity.recovery_messages("deliveredAt", "availableAt");
CREATE TABLE identity.security_events (
  id UUID PRIMARY KEY, action VARCHAR(40) NOT NULL, "actorId" UUID, "userId" UUID, "occurredAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX security_events_occurredAt_idx ON identity.security_events("occurredAt");
CREATE FUNCTION identity.reject_security_event_change() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Security events are append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER security_events_append_only BEFORE UPDATE OR DELETE ON identity.security_events
  FOR EACH ROW EXECUTE FUNCTION identity.reject_security_event_change();
