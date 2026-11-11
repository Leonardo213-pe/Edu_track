import type { MailConfig } from './modules/identity/identity.module';
export interface AppConfig {
  databaseUrl: string; jwtSecret: string; port: number; webOrigin: string; mail: MailConfig;
  /** Express "trust proxy" value; undefined keeps Express' default (no proxy trusted). */
  trustProxy?: boolean | number | string;
  academic?: { storageRoot?: string; submissionStorageRoot?: string };
  /** Period of the in-process exam jobs (expiry sweeper and outbox consumer); default 2000 ms. */
  examJobIntervalMs?: number;
  /** Period of the due-date reminder job; default 300000 ms. */
  reminderIntervalMs?: number;
  /** Academic Registry (SIMULATED in local Compose); without url/key the nightly synchronization stays idle. */
  registry?: { url?: string; apiKey?: string; retryBaseMs?: number; schedulerIntervalMs?: number; timeoutMs?: number };
  /** Period of the operational alert check (administration); default 60000 ms. */
  alertIntervalMs?: number;
  /** Directory on a volume separate from the database where the audit chain head is anchored (CAR-12). */
  audit?: { anchorDir?: string; anchorIntervalMs?: number };
  /** Object storage for course materials, submissions and audit anchors: local file system (default) or S3/R2. */
  storage?: { driver: 'local' | 's3'; s3?: { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string } };
  monitoring?: { p95Ms?: number; errorRatePct?: number; outboxAgeSeconds?: number; flushMs?: number; instanceId?: string };
}
function positive(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid ${name}`); return parsed;
}
export function parseStorage(env: NodeJS.ProcessEnv): AppConfig['storage'] {
  const driver = (env.STORAGE_DRIVER ?? 'local').trim();
  if (driver === 'local') return { driver: 'local' };
  if (driver !== 's3') throw new Error('STORAGE_DRIVER must be local or s3');
  const s3 = { endpoint: env.S3_ENDPOINT?.trim() ?? '', bucket: env.S3_BUCKET?.trim() ?? '', region: env.S3_REGION?.trim() || 'auto',
    accessKeyId: env.S3_ACCESS_KEY_ID?.trim() ?? '', secretAccessKey: env.S3_SECRET_ACCESS_KEY?.trim() ?? '' };
  // Without keys the ECS task role supplies temporary credentials (AWS); keys are for R2/MinIO or local tests.
  if (!/^https?:\/\//.test(s3.endpoint) || !s3.bucket || !s3.accessKeyId !== !s3.secretAccessKey)
    throw new Error('STORAGE_DRIVER=s3 requires S3_ENDPOINT, S3_BUCKET and both or none of S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY');
  return { driver: 's3', s3 };
}
export function parseRegistry(env: NodeJS.ProcessEnv): AppConfig['registry'] {
  const url = env.REGISTRY_URL?.trim() || undefined; const apiKey = env.REGISTRY_API_KEY?.trim() || undefined;
  if (!!url !== !!apiKey) throw new Error('REGISTRY_URL and REGISTRY_API_KEY must be set together');
  if (url && !['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('Invalid REGISTRY_URL');
  if (apiKey && apiKey.length < 16) throw new Error('REGISTRY_API_KEY requires at least 16 characters');
  return { url, apiKey, retryBaseMs: positive(env.REGISTRY_RETRY_BASE_MS, 'REGISTRY_RETRY_BASE_MS'),
    schedulerIntervalMs: positive(env.REGISTRY_SCHEDULER_INTERVAL_MS, 'REGISTRY_SCHEDULER_INTERVAL_MS'), timeoutMs: positive(env.REGISTRY_TIMEOUT_MS, 'REGISTRY_TIMEOUT_MS') };
}
export function parseTrustProxy(value: string | undefined): AppConfig['trustProxy'] {
  if (value === undefined || value.trim() === '') return undefined;
  const raw = value.trim();
  if (raw === 'false') return false;
  if (/^\d{1,2}$/.test(raw)) return Number(raw);
  // Named ranges (loopback, linklocal, uniquelocal) or explicit IP/CIDR lists; "true" (trust everyone) is rejected.
  if (raw === 'true' || !/^[\w.:/, -]+$/.test(raw)) throw new Error('Invalid TRUST_PROXY');
  return raw;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  const jwtSecret = env.JWT_SECRET;
  const port = Number(env.PORT ?? 3000);
  const webOrigin = env.WEB_ORIGIN ?? 'http://localhost:5173';
  if (!databaseUrl || !/^postgres(ql)?:\/\//.test(databaseUrl)) throw new Error('DATABASE_URL is required (PostgreSQL)');
  if (!jwtSecret || Buffer.byteLength(jwtSecret) < 48) throw new Error('JWT_SECRET requires at least 48 bytes');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const origin = new URL(webOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== webOrigin) throw new Error('Invalid WEB_ORIGIN');
  const host = env.SMTP_HOST ?? 'localhost'; const smtpPort = Number(env.SMTP_PORT ?? 1025);
  const secure = env.SMTP_SECURE === 'true';
  const requireTLS = env.SMTP_REQUIRE_TLS !== 'false' && (env.SMTP_REQUIRE_TLS === 'true' || !['localhost', '127.0.0.1', 'mailpit'].includes(host));
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535 || !!env.SMTP_USER !== !!env.SMTP_PASSWORD)
    throw new Error('Invalid SMTP configuration');
  if (!['localhost', '127.0.0.1', 'mailpit'].includes(host) && !secure && !requireTLS) throw new Error('Remote SMTP requires TLS');
  const from = env.SMTP_FROM ?? 'EduTrack <noreply@edutrack.test>';
  if (/[\r\n]/.test(from)) throw new Error('Invalid SMTP_FROM');
  if (env.ALLOW_TEST_ENROLLMENTS === 'true' || env.ENROLLMENT_FIXTURES_FILE?.trim())
    throw new Error('Enrollment JSON fixtures were removed; synchronize the official roster through /api/enrollments');
  return { databaseUrl, jwtSecret, port, webOrigin, trustProxy: parseTrustProxy(env.TRUST_PROXY),
    academic: { storageRoot: env.COURSE_STORAGE_ROOT, submissionStorageRoot: env.SUBMISSION_STORAGE_ROOT }, registry: parseRegistry(env), storage: parseStorage(env),
    alertIntervalMs: positive(env.ALERT_INTERVAL_MS, 'ALERT_INTERVAL_MS'),
    audit: { anchorDir: env.AUDIT_ANCHOR_DIR?.trim() || undefined, anchorIntervalMs: positive(env.AUDIT_ANCHOR_INTERVAL_MS, 'AUDIT_ANCHOR_INTERVAL_MS') },
    monitoring: { p95Ms: positive(env.MONITOR_P95_MS, 'MONITOR_P95_MS'), errorRatePct: positive(env.MONITOR_ERROR_RATE_PCT, 'MONITOR_ERROR_RATE_PCT'),
      outboxAgeSeconds: positive(env.MONITOR_OUTBOX_AGE_SECONDS, 'MONITOR_OUTBOX_AGE_SECONDS'), flushMs: positive(env.METRICS_FLUSH_MS, 'METRICS_FLUSH_MS'),
      instanceId: env.INSTANCE_ID?.trim().slice(0, 80) || undefined },
    mail: { host, port: smtpPort, from, secure, requireTLS, user: env.SMTP_USER, password: env.SMTP_PASSWORD, webOrigin } };
}
