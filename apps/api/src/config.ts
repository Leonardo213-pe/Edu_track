export interface AppConfig { databaseUrl: string; jwtSecret: string; port: number; webOrigin: string }
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
  return { databaseUrl, jwtSecret, port, webOrigin };
}
