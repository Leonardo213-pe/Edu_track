-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "courses";

-- CreateEnum
CREATE TYPE "courses"."CourseStatus" AS ENUM ('BORRADOR', 'EN_REVISION', 'PUBLICADO', 'ARCHIVADO');

-- CreateTable
CREATE TABLE "courses"."courses" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT NOT NULL,
    "period" VARCHAR(40) NOT NULL,
    "teacherId" UUID NOT NULL,
    "syllabus" TEXT NOT NULL DEFAULT '',
    "status" "courses"."CourseStatus" NOT NULL DEFAULT 'BORRADOR',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."units" (
    "id" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."sessions" (
    "id" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."materials" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."material_versions" (
    "id" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "filename" TEXT,
    "mimeType" TEXT,
    "storageKey" TEXT,
    "size" INTEGER,
    "sha256" VARCHAR(64),
    "url" TEXT,
    "authorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "material_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."reviews" (
    "id" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "decision" VARCHAR(20) NOT NULL,
    "observations" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."completions" (
    "userId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "completedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "completions_pkey" PRIMARY KEY ("userId","versionId")
);

-- CreateIndex
CREATE INDEX "courses_teacherId_status_idx" ON "courses"."courses"("teacherId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "courses_code_period_key" ON "courses"."courses"("code", "period");

-- CreateIndex
ALTER TABLE "courses"."units" ADD CONSTRAINT "units_courseId_position_key" UNIQUE ("courseId", "position") DEFERRABLE INITIALLY DEFERRED;

-- CreateIndex
ALTER TABLE "courses"."sessions" ADD CONSTRAINT "sessions_unitId_position_key" UNIQUE ("unitId", "position") DEFERRABLE INITIALLY DEFERRED;

-- CreateIndex
ALTER TABLE "courses"."materials" ADD CONSTRAINT "materials_sessionId_position_key" UNIQUE ("sessionId", "position") DEFERRABLE INITIALLY DEFERRED;

-- CreateIndex
CREATE UNIQUE INDEX "material_versions_storageKey_key" ON "courses"."material_versions"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "material_versions_materialId_number_key" ON "courses"."material_versions"("materialId", "number");

-- CreateIndex
CREATE INDEX "reviews_courseId_createdAt_idx" ON "courses"."reviews"("courseId", "createdAt");

-- CreateIndex
CREATE INDEX "completions_userId_courseId_idx" ON "courses"."completions"("userId", "courseId");

-- AddForeignKey
ALTER TABLE "courses"."units" ADD CONSTRAINT "units_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"."courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."sessions" ADD CONSTRAINT "sessions_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "courses"."units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."materials" ADD CONSTRAINT "materials_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "courses"."sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."material_versions" ADD CONSTRAINT "material_versions_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "courses"."materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."reviews" ADD CONSTRAINT "reviews_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"."courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."completions" ADD CONSTRAINT "completions_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"."courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."completions" ADD CONSTRAINT "completions_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "courses"."material_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE courses.courses ADD CONSTRAINT course_revision_nonnegative CHECK (revision >= 0);
ALTER TABLE courses.units ADD CONSTRAINT unit_position_nonnegative CHECK (position >= 0);
ALTER TABLE courses.sessions ADD CONSTRAINT session_position_nonnegative CHECK (position >= 0);
ALTER TABLE courses.materials ADD CONSTRAINT material_position_nonnegative CHECK (position >= 0);
ALTER TABLE courses.material_versions ADD CONSTRAINT version_number_positive CHECK (number > 0),
  ADD CONSTRAINT version_kind_valid CHECK (kind IN ('FILE','LINK','VIDEO')),
  ADD CONSTRAINT version_payload_valid CHECK (
    (kind = 'FILE' AND "storageKey" IS NOT NULL AND filename IS NOT NULL AND "mimeType" IS NOT NULL AND size > 0 AND sha256 IS NOT NULL AND url IS NULL)
    OR (kind IN ('LINK','VIDEO') AND url IS NOT NULL AND "storageKey" IS NULL AND size IS NULL));
ALTER TABLE courses.completions ADD CONSTRAINT completions_material_fkey FOREIGN KEY ("materialId") REFERENCES courses.materials(id) ON DELETE CASCADE;
CREATE FUNCTION courses.reject_version_update() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Material versions cannot be overwritten'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER material_versions_no_update BEFORE UPDATE ON courses.material_versions FOR EACH ROW EXECUTE FUNCTION courses.reject_version_update();
