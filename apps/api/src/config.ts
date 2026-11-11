import type { MailConfig } from './modules/identity/identity.module';
export interface AppConfig {
  databaseUrl: string; jwtSecret: string; port: number; webOrigin: string; mail: MailConfig;
  /** Express "trust proxy" value; undefined keeps Express' default (no proxy trusted). */
  trustProxy?: boolean | number | string;
  academic?: { storageRoot?: string };
  /** Period of the in-process exam jobs (expiry sweeper and outbox consumer); default 2000 ms. */
  examJobIntervalMs?: number;
  /** Period of the due-date reminder job; default 300000 ms. */
  reminderIntervalMs?: number;
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
    academic: { storageRoot: env.COURSE_STORAGE_ROOT },
    mail: { host, port: smtpPort, from, secure, requireTLS, user: env.SMTP_USER, password: env.SMTP_PASSWORD, webOrigin } };
}
