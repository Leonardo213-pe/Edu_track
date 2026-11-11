-- Phase 8: forums and notifications (CAR-07), connection time and configurable risk rules (CAR-08).
CREATE SCHEMA IF NOT EXISTS collaboration;
CREATE TABLE collaboration.forums (
  id UUID PRIMARY KEY,
  "courseId" UUID NOT NULL,
  "unitId" UUID,
  title VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  "createdBy" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "forums_courseId_idx" ON collaboration.forums("courseId");
CREATE TABLE collaboration.threads (
  id UUID PRIMARY KEY,
  "forumId" UUID NOT NULL REFERENCES collaboration.forums(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "authorId" UUID NOT NULL,
  title VARCHAR(160) NOT NULL,
  pinned BOOLEAN NOT NULL DEFAULT false,
  locked BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(3) NOT NULL,
  "lastActivityAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "threads_forumId_lastActivityAt_idx" ON collaboration.threads("forumId", "lastActivityAt");
CREATE TABLE collaboration.messages (
  id UUID PRIMARY KEY,
  "threadId" UUID NOT NULL REFERENCES collaboration.threads(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "authorId" UUID NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  "createdAt" TIMESTAMPTZ(3) NOT NULL,
  hidden BOOLEAN NOT NULL DEFAULT false,
  "hiddenBy" UUID,
  "hiddenReason" VARCHAR(500),
  CONSTRAINT message_moderation CHECK (hidden = ("hiddenBy" IS NOT NULL AND "hiddenReason" IS NOT NULL))
);
CREATE INDEX "messages_threadId_createdAt_idx" ON collaboration.messages("threadId", "createdAt");
-- Message text is never rewritten: moderation only hides it (and records who and why).
CREATE FUNCTION collaboration.guard_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body OR NEW."authorId" IS DISTINCT FROM OLD."authorId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Forum messages cannot be edited';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER messages_guard BEFORE UPDATE ON collaboration.messages FOR EACH ROW EXECUTE FUNCTION collaboration.guard_message();
CREATE TABLE collaboration.subscriptions (
  "threadId" UUID NOT NULL REFERENCES collaboration.threads(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT subscriptions_pkey PRIMARY KEY ("threadId", "userId")
);
CREATE INDEX "subscriptions_userId_idx" ON collaboration.subscriptions("userId");
CREATE TABLE collaboration.notifications (
  id UUID PRIMARY KEY,
  "userId" UUID NOT NULL,
  type VARCHAR(30) NOT NULL CHECK (type IN ('FORUM_REPLY', 'FORUM_NEW_THREAD', 'DUE_SOON', 'GRADE')),
  title VARCHAR(200) NOT NULL,
  body VARCHAR(1000) NOT NULL,
  link JSONB NOT NULL,
  "dedupeKey" VARCHAR(200),
  "createdAt" TIMESTAMPTZ(3) NOT NULL,
  "readAt" TIMESTAMPTZ(3),
  CONSTRAINT "notifications_dedupeKey_key" UNIQUE ("dedupeKey")
);
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON collaboration.notifications("userId", "readAt", "createdAt");

CREATE SCHEMA IF NOT EXISTS analytics;
CREATE TABLE analytics.activity (
  "userId" UUID NOT NULL,
  "courseId" UUID NOT NULL,
  day DATE NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 0 CHECK (minutes BETWEEN 0 AND 1440),
  "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT activity_pkey PRIMARY KEY ("userId", "courseId", day)
);
CREATE INDEX "activity_courseId_day_idx" ON analytics.activity("courseId", day);
CREATE TABLE analytics.risk_rules (
  "courseId" UUID PRIMARY KEY,
  "minProgress" INTEGER NOT NULL CHECK ("minProgress" BETWEEN 0 AND 100),
  "minAverageCents" INTEGER NOT NULL CHECK ("minAverageCents" BETWEEN 0 AND 2000),
  "maxInactiveDays" INTEGER NOT NULL CHECK ("maxInactiveDays" BETWEEN 1 AND 365),
  "maxMissed" INTEGER NOT NULL CHECK ("maxMissed" BETWEEN 1 AND 100),
  "updatedBy" UUID NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
