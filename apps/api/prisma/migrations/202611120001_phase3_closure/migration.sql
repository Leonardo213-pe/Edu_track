-- Phase 3 closure: session duration (Composite), append-only course history,
-- immutable review decisions and the local enrollment projection (CAR-09 consumer).

ALTER TABLE courses.sessions ADD COLUMN "durationMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT session_duration_range CHECK ("durationMinutes" BETWEEN 0 AND 1440);

ALTER TABLE courses.reviews ADD CONSTRAINT review_decision_valid
  CHECK (decision IN ('SUBMITTED','APPROVED','REJECTED','REOPENED','ARCHIVED'));
CREATE FUNCTION courses.reject_review_update() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Review decisions cannot be modified'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER reviews_no_update BEFORE UPDATE ON courses.reviews FOR EACH ROW EXECUTE FUNCTION courses.reject_review_update();

CREATE TABLE courses.changes (
  id UUID PRIMARY KEY,
  "courseId" UUID NOT NULL REFERENCES courses.courses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  "actorId" UUID NOT NULL,
  action VARCHAR(40) NOT NULL,
  detail JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "changes_courseId_createdAt_idx" ON courses.changes("courseId", "createdAt");
CREATE FUNCTION courses.reject_change_update() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Course history is append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER changes_no_update BEFORE UPDATE ON courses.changes FOR EACH ROW EXECUTE FUNCTION courses.reject_change_update();

CREATE SCHEMA IF NOT EXISTS enrollments;
CREATE TABLE enrollments.enrollments (
  "studentId" UUID NOT NULL,
  "courseId" UUID NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT enrollments_pkey PRIMARY KEY ("studentId", "courseId")
);
CREATE INDEX "enrollments_courseId_active_idx" ON enrollments.enrollments("courseId", active);
CREATE TABLE enrollments.runs (
  id UUID PRIMARY KEY,
  "courseId" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  source VARCHAR(40) NOT NULL,
  added INTEGER NOT NULL CHECK (added >= 0),
  removed INTEGER NOT NULL CHECK (removed >= 0),
  total INTEGER NOT NULL CHECK (total >= 0),
  "occurredAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "runs_courseId_occurredAt_idx" ON enrollments.runs("courseId", "occurredAt");
CREATE FUNCTION enrollments.reject_run_change() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Enrollment runs are append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER runs_append_only BEFORE UPDATE OR DELETE ON enrollments.runs FOR EACH ROW EXECUTE FUNCTION enrollments.reject_run_change();
