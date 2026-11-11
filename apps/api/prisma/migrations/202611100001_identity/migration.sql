CREATE SCHEMA IF NOT EXISTS "identity";
CREATE TYPE "identity"."Role" AS ENUM ('STUDENT', 'TEACHER', 'INSTRUCTIONAL_DESIGNER', 'ADMIN');
CREATE TABLE "identity"."users" (
  "id" UUID NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "displayName" VARCHAR(100) NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "identity"."Role" NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_email_normalized" CHECK ("email" = lower(trim("email")))
);
CREATE UNIQUE INDEX "users_email_key" ON "identity"."users"("email");
