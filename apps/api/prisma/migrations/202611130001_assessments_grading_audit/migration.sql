-- Phase 4: immutable audit (CAR-12/EAC-04), question banks and assessments (CAR-04), LMS grades (CAR-06).

-- ===================== audit =====================
CREATE SCHEMA IF NOT EXISTS audit;
CREATE TABLE audit.entries (
  id BIGSERIAL PRIMARY KEY,
  entity VARCHAR(40) NOT NULL,
  "entityId" UUID NOT NULL,
  action VARCHAR(10) NOT NULL,
  before JSONB,
  after JSONB,
  "actorId" UUID NOT NULL,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL,
  "prevHash" CHAR(64) NOT NULL,
  hash CHAR(64) NOT NULL,
  CONSTRAINT entries_hash_key UNIQUE (hash)
);
CREATE INDEX "entries_entity_entityId_idx" ON audit.entries(entity, "entityId");

-- Canonical text that is hashed: identical expression for writing and verifying.
CREATE FUNCTION audit.entry_payload(p_id BIGINT, p_prev CHAR(64), p_entity TEXT, p_entity_id UUID, p_action TEXT,
  p_before JSONB, p_after JSONB, p_actor UUID, p_at TIMESTAMPTZ) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT concat_ws('|', p_id::text, p_prev, p_entity, p_entity_id::text, p_action, coalesce(p_before::text, 'null'),
    coalesce(p_after::text, 'null'), p_actor::text, to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$$;

-- Public write contract of the audit module: callers invoke it inside their own transaction (atomic change + audit).
CREATE FUNCTION audit.append_entry(p_entity TEXT, p_entity_id UUID, p_action TEXT, p_before JSONB, p_after JSONB, p_actor UUID)
RETURNS CHAR(64) LANGUAGE plpgsql AS $$
DECLARE v_prev CHAR(64); v_id BIGINT; v_at TIMESTAMPTZ := clock_timestamp(); v_hash CHAR(64);
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Audited change requires an actor (edutrack.actor)'; END IF;
  -- One chain: serialize appenders until commit so each entry links to the committed predecessor.
  PERFORM pg_advisory_xact_lock(7212012);
  SELECT e.hash INTO v_prev FROM audit.entries e ORDER BY e.id DESC LIMIT 1;
  v_prev := coalesce(v_prev, repeat('0', 64));
  v_id := nextval(pg_get_serial_sequence('audit.entries', 'id'));
  v_hash := encode(sha256(convert_to(audit.entry_payload(v_id, v_prev, p_entity, p_entity_id, p_action, p_before, p_after, p_actor, v_at), 'UTF8')), 'hex');
  INSERT INTO audit.entries(id, entity, "entityId", action, before, after, "actorId", "occurredAt", "prevHash", hash)
    VALUES (v_id, p_entity, p_entity_id, p_action, p_before, p_after, p_actor, v_at, v_prev, v_hash);
  RETURN v_hash;
END $$;

-- Generic row trigger: TG_ARGV[0] is the audited entity name; the actor comes from the transaction-local setting.
CREATE FUNCTION audit.record_row_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM audit.append_entry(TG_ARGV[0], NEW.id, TG_OP, CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END, to_jsonb(NEW),
    nullif(current_setting('edutrack.actor', true), '')::uuid);
  RETURN NEW;
END $$;

CREATE FUNCTION audit.verify_chain() RETURNS TABLE(checked BIGINT, first_invalid BIGINT) LANGUAGE plpgsql STABLE AS $$
DECLARE r RECORD; v_prev CHAR(64) := repeat('0', 64); v_count BIGINT := 0;
BEGIN
  FOR r IN SELECT * FROM audit.entries ORDER BY id LOOP
    v_count := v_count + 1;
    IF r."prevHash" <> v_prev OR r.hash <> encode(sha256(convert_to(audit.entry_payload(r.id, r."prevHash", r.entity, r."entityId",
        r.action, r.before, r.after, r."actorId", r."occurredAt"), 'UTF8')), 'hex') THEN
      checked := v_count; first_invalid := r.id; RETURN NEXT; RETURN;
    END IF;
    v_prev := r.hash;
  END LOOP;
  checked := v_count; first_invalid := NULL; RETURN NEXT;
END $$;

CREATE FUNCTION audit.reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit entries are immutable'; END $$;
CREATE TRIGGER entries_immutable BEFORE UPDATE OR DELETE ON audit.entries FOR EACH ROW EXECUTE FUNCTION audit.reject_change();
CREATE TRIGGER entries_no_truncate BEFORE TRUNCATE ON audit.entries FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_change();

-- ===================== assessments =====================
CREATE SCHEMA IF NOT EXISTS assessments;
CREATE TABLE assessments.banks (
  id UUID PRIMARY KEY,
  "courseId" UUID NOT NULL,
  name VARCHAR(160) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "banks_courseId_name_key" UNIQUE ("courseId", name)
);
CREATE TABLE assessments.questions (
  id UUID PRIMARY KEY,
  "bankId" UUID NOT NULL REFERENCES assessments.banks(id) ON DELETE CASCADE ON UPDATE CASCADE,
  type VARCHAR(12) NOT NULL CHECK (type IN ('SINGLE', 'MULTIPLE', 'TRUE_FALSE')),
  statement TEXT NOT NULL,
  "pointsCents" INTEGER NOT NULL CHECK ("pointsCents" BETWEEN 1 AND 10000),
  options JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "questions_bankId_idx" ON assessments.questions("bankId");
CREATE TABLE assessments.assessments (
  id UUID PRIMARY KEY,
  "courseId" UUID NOT NULL,
  title VARCHAR(160) NOT NULL,
  instructions TEXT NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('QUIZ', 'RUBRIC')),
  "weightBp" INTEGER NOT NULL CHECK ("weightBp" BETWEEN 1 AND 10000),
  "dueAt" TIMESTAMPTZ(3) NOT NULL,
  "durationMinutes" INTEGER CHECK ("durationMinutes" BETWEEN 1 AND 1440),
  "questionCount" INTEGER CHECK ("questionCount" BETWEEN 1 AND 200),
  "bankId" UUID,
  criteria JSONB NOT NULL,
  status VARCHAR(10) NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'CLOSED')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  "publishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT assessment_quiz_fields CHECK (type <> 'QUIZ' OR ("durationMinutes" IS NOT NULL AND "questionCount" IS NOT NULL AND "bankId" IS NOT NULL))
);
CREATE INDEX "assessments_courseId_idx" ON assessments.assessments("courseId");
CREATE TABLE assessments.snapshot_questions (
  "assessmentId" UUID NOT NULL REFERENCES assessments.assessments(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "questionId" UUID NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  type VARCHAR(12) NOT NULL,
  statement TEXT NOT NULL,
  "pointsCents" INTEGER NOT NULL,
  options JSONB NOT NULL,
  CONSTRAINT snapshot_questions_pkey PRIMARY KEY ("assessmentId", "questionId")
);
CREATE FUNCTION assessments.reject_snapshot_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Published question snapshots are immutable'; END $$;
CREATE TRIGGER snapshot_immutable BEFORE UPDATE OR DELETE ON assessments.snapshot_questions FOR EACH ROW EXECUTE FUNCTION assessments.reject_snapshot_change();
CREATE FUNCTION assessments.reject_published_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'Published assessments cannot be deleted'; END IF; RETURN OLD; END $$;
CREATE TRIGGER assessments_no_published_delete BEFORE DELETE ON assessments.assessments FOR EACH ROW EXECUTE FUNCTION assessments.reject_published_delete();
-- Publishing and every later modification of a published assessment are audited atomically (CAR-12).
CREATE TRIGGER assessments_audit AFTER UPDATE ON assessments.assessments FOR EACH ROW
  WHEN (OLD.status <> 'DRAFT' OR NEW.status <> 'DRAFT') EXECUTE FUNCTION audit.record_row_change('ASSESSMENT');

-- ===================== grading =====================
CREATE SCHEMA IF NOT EXISTS grading;
CREATE TABLE grading.grades (
  id UUID PRIMARY KEY,
  "assessmentId" UUID NOT NULL,
  "courseId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "scoreCents" INTEGER NOT NULL CHECK ("scoreCents" BETWEEN 0 AND 2000),
  origin VARCHAR(10) NOT NULL CHECK (origin IN ('AUTOMATIC', 'RUBRIC')),
  detail JSONB NOT NULL,
  reason TEXT NOT NULL,
  "gradedBy" UUID NOT NULL,
  "gradedAt" TIMESTAMPTZ(3) NOT NULL,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  CONSTRAINT "grades_assessmentId_studentId_key" UNIQUE ("assessmentId", "studentId")
);
CREATE INDEX "grades_courseId_studentId_idx" ON grading.grades("courseId", "studentId");
CREATE FUNCTION grading.reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Grades cannot be deleted; register a new value instead'; END $$;
CREATE TRIGGER grades_no_delete BEFORE DELETE ON grading.grades FOR EACH ROW EXECUTE FUNCTION grading.reject_delete();
-- Every grade insert or change writes its audit entry in the same transaction (EAC-04).
CREATE TRIGGER grades_audit AFTER INSERT OR UPDATE ON grading.grades FOR EACH ROW EXECUTE FUNCTION audit.record_row_change('GRADE');
