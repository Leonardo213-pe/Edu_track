import type { MailConfig } from './modules/identity/infrastructure/notifications/smtp-reset-mailer';
export interface AppConfig { databaseUrl: string; jwtSecret: string; port: number; webOrigin: string; mail: MailConfig;
  academic?: { storageRoot?: string; enrollmentFixtureFile?: string; allowTestEnrollments?: boolean } }
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
  return { databaseUrl, jwtSecret, port, webOrigin, academic: { storageRoot: env.COURSE_STORAGE_ROOT,
    enrollmentFixtureFile: env.ENROLLMENT_FIXTURES_FILE, allowTestEnrollments: env.ALLOW_TEST_ENROLLMENTS === 'true' }, mail: { host, port: smtpPort, from, secure, requireTLS,
    user: env.SMTP_USER, password: env.SMTP_PASSWORD, webOrigin } };
}
