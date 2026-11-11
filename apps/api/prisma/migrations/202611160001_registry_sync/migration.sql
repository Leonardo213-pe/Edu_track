-- Part A (CAR-09, EAC-06, CU-12): nightly synchronization with the Academic Registry (SIMULATED in local Compose).
-- Link between an LMS course and its registry section (code + period). Owned by enrollments; courses report changes
-- through the public contract REGISTRY_SECTIONS.
CREATE TABLE enrollments.sections (
  "courseId" UUID PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  period VARCHAR(40) NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "sections_code_period_idx" ON enrollments.sections(code, period);
-- One-time backfill of existing courses (data migration only; application code never reads another schema).
INSERT INTO enrollments.sections ("courseId", code, period, "updatedAt")
  SELECT id, code, period, now() FROM courses.courses ON CONFLICT DO NOTHING;

-- Each synchronization run. The unique slot makes the nightly run happen once per day across replicas.
CREATE TABLE enrollments.sync_runs (
  id UUID PRIMARY KEY,
  trigger VARCHAR(10) NOT NULL CHECK (trigger IN ('SCHEDULED', 'MANUAL')),
  slot VARCHAR(40),
  "actorId" UUID NOT NULL,
  status VARCHAR(10) NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "finishedAt" TIMESTAMPTZ(3),
  sections INT NOT NULL DEFAULT 0 CHECK (sections >= 0),
  added INT NOT NULL DEFAULT 0 CHECK (added >= 0),
  removed INT NOT NULL DEFAULT 0 CHECK (removed >= 0),
  unknown INT NOT NULL DEFAULT 0 CHECK (unknown >= 0),
  skipped INT NOT NULL DEFAULT 0 CHECK (skipped >= 0),
  retries INT NOT NULL DEFAULT 0 CHECK (retries >= 0),
  error VARCHAR(200),
  CONSTRAINT "sync_runs_slot_key" UNIQUE (slot),
  CONSTRAINT sync_run_finished CHECK ((status = 'RUNNING') = ("finishedAt" IS NULL)),
  CONSTRAINT sync_run_failed CHECK ((status = 'FAILED') = (error IS NOT NULL))
);
CREATE INDEX "sync_runs_startedAt_idx" ON enrollments.sync_runs("startedAt");
-- A finished run is history: it cannot be rewritten or deleted.
CREATE FUNCTION enrollments.guard_sync_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Synchronization runs cannot be deleted'; END IF;
  IF OLD.status <> 'RUNNING' THEN RAISE EXCEPTION 'Finished synchronization runs are immutable'; END IF;
  IF NEW.id <> OLD.id OR NEW.trigger <> OLD.trigger OR NEW.slot IS DISTINCT FROM OLD.slot OR NEW."startedAt" <> OLD."startedAt" THEN
    RAISE EXCEPTION 'Synchronization run identity cannot change';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sync_runs_guard BEFORE UPDATE OR DELETE ON enrollments.sync_runs FOR EACH ROW EXECUTE FUNCTION enrollments.guard_sync_run();

-- System alerts (registry failures, monitoring thresholds) and submission events reach the in-app inbox.
ALTER TABLE collaboration.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE collaboration.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('FORUM_REPLY', 'FORUM_NEW_THREAD', 'DUE_SOON', 'GRADE', 'SYSTEM_ALERT', 'SUBMISSION'));
