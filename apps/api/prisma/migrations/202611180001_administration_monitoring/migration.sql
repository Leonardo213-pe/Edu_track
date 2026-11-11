-- Part C (CAR-14, CU-14): request metrics merged across API replicas and replica heartbeats.
CREATE SCHEMA IF NOT EXISTS administration;
CREATE TABLE administration.request_metrics (
  minute TIMESTAMPTZ(3) NOT NULL,
  instance VARCHAR(80) NOT NULL,
  method VARCHAR(10) NOT NULL,
  route VARCHAR(200) NOT NULL,
  count INT NOT NULL CHECK (count >= 0),
  errors INT NOT NULL CHECK (errors >= 0 AND errors <= count),
  "totalMs" BIGINT NOT NULL CHECK ("totalMs" >= 0),
  -- Fixed latency histogram (administration/domain/metrics.ts LATENCY_BUCKETS_MS + overflow slot).
  buckets INT[] NOT NULL CHECK (cardinality(buckets) = 15),
  PRIMARY KEY (minute, instance, method, route)
);
CREATE INDEX "request_metrics_minute_idx" ON administration.request_metrics(minute);
CREATE TABLE administration.instances (
  id VARCHAR(80) PRIMARY KEY,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "lastSeenAt" TIMESTAMPTZ(3) NOT NULL
);
