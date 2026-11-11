-- Phase 5: timed exam attempts (CU-03), idempotent versioned autosave (CAR-11, EAC-01/03) and transactional outbox.
CREATE SCHEMA IF NOT EXISTS exams;

CREATE TABLE exams.attempts (
  id UUID PRIMARY KEY,
  "assessmentId" UUID NOT NULL,
  "courseId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  status VARCHAR(12) NOT NULL CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED')),
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "finalizedAt" TIMESTAMPTZ(3),
  "finalizedBy" VARCHAR(10) CHECK ("finalizedBy" IN ('STUDENT', 'TIMEOUT')),
  questions JSONB NOT NULL,
  CONSTRAINT "attempts_assessmentId_studentId_key" UNIQUE ("assessmentId", "studentId"),
  CONSTRAINT attempt_window CHECK ("expiresAt" > "startedAt"),
  CONSTRAINT attempt_finalization CHECK ((status = 'IN_PROGRESS') = ("finalizedAt" IS NULL AND "finalizedBy" IS NULL))
);
CREATE INDEX "attempts_status_expiresAt_idx" ON exams.attempts(status, "expiresAt");

-- One row per attempt/question: students never contend with each other (EAC-01).
CREATE TABLE exams.answers (
  "attemptId" UUID NOT NULL REFERENCES exams.attempts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "questionId" UUID NOT NULL,
  "optionIds" JSONB NOT NULL,
  version BIGINT NOT NULL CHECK (version > 0),
  "savedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT answers_pkey PRIMARY KEY ("attemptId", "questionId")
);

CREATE TABLE exams.outbox (
  id UUID PRIMARY KEY,
  type VARCHAR(40) NOT NULL,
  "aggregateId" UUID NOT NULL,
  payload JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL,
  "availableAt" TIMESTAMPTZ(3) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  "processedAt" TIMESTAMPTZ(3),
  "lastError" VARCHAR(200)
);
CREATE INDEX "outbox_processedAt_availableAt_idx" ON exams.outbox("processedAt", "availableAt");

-- The database clock decides: no answer is stored for a finalized or expired attempt, whatever the caller.
CREATE FUNCTION exams.guard_answer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM exams.attempts a WHERE a.id = NEW."attemptId" AND a.status = 'IN_PROGRESS' AND a."expiresAt" > clock_timestamp()) THEN
    RAISE EXCEPTION 'Attempt is closed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER answers_open_attempt BEFORE INSERT OR UPDATE ON exams.answers FOR EACH ROW EXECUTE FUNCTION exams.guard_answer();

-- Drawn questions, timing and owner are fixed at start; a finalized attempt never changes.
CREATE FUNCTION exams.guard_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'IN_PROGRESS' THEN RAISE EXCEPTION 'Finalized attempts are immutable'; END IF;
  IF NEW.questions IS DISTINCT FROM OLD.questions OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt"
    OR NEW."studentId" IS DISTINCT FROM OLD."studentId" OR NEW."assessmentId" IS DISTINCT FROM OLD."assessmentId" THEN
    RAISE EXCEPTION 'Attempt definition is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attempts_guard BEFORE UPDATE ON exams.attempts FOR EACH ROW EXECUTE FUNCTION exams.guard_attempt();

CREATE FUNCTION exams.reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Exam records cannot be deleted'; END $$;
CREATE TRIGGER attempts_no_delete BEFORE DELETE ON exams.attempts FOR EACH ROW EXECUTE FUNCTION exams.reject_delete();
CREATE TRIGGER answers_no_delete BEFORE DELETE ON exams.answers FOR EACH ROW EXECUTE FUNCTION exams.reject_delete();
