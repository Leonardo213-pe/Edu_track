-- Part B (CAR-05, CAR-10, CU-04, CU-15): file submissions of rubric assignments ("Tareas") and similarity reports.
CREATE SCHEMA IF NOT EXISTS submissions;
-- Current submission of each student per assignment; each received file is kept as an immutable version.
CREATE TABLE submissions.submissions (
  id UUID PRIMARY KEY,
  "assessmentId" UUID NOT NULL,
  "courseId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  version INT NOT NULL CHECK (version >= 1),
  "currentFileId" UUID NOT NULL,
  "firstSubmittedAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "submissions_assessmentId_studentId_key" UNIQUE ("assessmentId", "studentId")
);
CREATE INDEX "submissions_courseId_idx" ON submissions.submissions("courseId");
CREATE TABLE submissions.files (
  id UUID PRIMARY KEY,
  "submissionId" UUID NOT NULL REFERENCES submissions.submissions(id) DEFERRABLE INITIALLY DEFERRED,
  version INT NOT NULL CHECK (version >= 1),
  "storageKey" VARCHAR(64) NOT NULL UNIQUE,
  filename VARCHAR(180) NOT NULL,
  "mimeType" VARCHAR(120) NOT NULL,
  size INT NOT NULL CHECK (size > 0),
  sha256 CHAR(64) NOT NULL,
  -- Plain text extracted at reception for the similarity check (NULL when the format has no extractable text).
  "textContent" TEXT,
  "receivedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "files_submissionId_version_key" UNIQUE ("submissionId", version)
);
-- Received files are evidence: never rewritten nor deleted.
CREATE FUNCTION submissions.reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Submission files are immutable'; END $$;
CREATE TRIGGER files_immutable BEFORE UPDATE OR DELETE ON submissions.files FOR EACH ROW EXECUTE FUNCTION submissions.reject_change();
-- Submissions only move forward (version +1 with a new file) and are never deleted.
CREATE FUNCTION submissions.guard_submission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Submissions cannot be deleted'; END IF;
  IF NEW."assessmentId" <> OLD."assessmentId" OR NEW."studentId" <> OLD."studentId" OR NEW."courseId" <> OLD."courseId"
     OR NEW."firstSubmittedAt" <> OLD."firstSubmittedAt" OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Submissions only advance to the next version';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER submissions_guard BEFORE UPDATE OR DELETE ON submissions.submissions FOR EACH ROW EXECUTE FUNCTION submissions.guard_submission();
-- Transactional outbox: SubmissionReceived.v1 is written in the same transaction as the file version.
CREATE TABLE submissions.outbox (
  id UUID PRIMARY KEY,
  type VARCHAR(40) NOT NULL,
  "aggregateId" UUID NOT NULL,
  payload JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL,
  "availableAt" TIMESTAMPTZ(3) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  "processedAt" TIMESTAMPTZ(3),
  "lastError" VARCHAR(200)
);
CREATE INDEX "outbox_processedAt_availableAt_idx" ON submissions.outbox("processedAt", "availableAt");

CREATE SCHEMA IF NOT EXISTS plagiarism;
-- One similarity report per received file (idempotent consumer: the unique file ID absorbs redeliveries).
CREATE TABLE plagiarism.reports (
  id UUID PRIMARY KEY,
  "fileId" UUID NOT NULL UNIQUE,
  "submissionId" UUID NOT NULL,
  "assessmentId" UUID NOT NULL,
  "courseId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  status VARCHAR(12) NOT NULL CHECK (status IN ('COMPLETED', 'UNSUPPORTED')),
  "similarityBp" INT CHECK ("similarityBp" BETWEEN 0 AND 10000),
  matches JSONB NOT NULL,
  provider VARCHAR(40) NOT NULL,
  "comparedWith" INT NOT NULL CHECK ("comparedWith" >= 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT report_score CHECK ((status = 'COMPLETED') = ("similarityBp" IS NOT NULL))
);
CREATE INDEX "reports_assessmentId_idx" ON plagiarism.reports("assessmentId");
