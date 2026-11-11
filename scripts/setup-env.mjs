import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const password = randomBytes(24).toString('hex');
const secret = randomBytes(48).toString('hex');
const registryKey = randomBytes(24).toString('hex');
writeFileSync(new URL('../.env', import.meta.url), [
  'POSTGRES_USER=edutrack', 'POSTGRES_DB=edutrack', `POSTGRES_PASSWORD=${password}`,
  'POSTGRES_PORT=5432', `DATABASE_URL=postgresql://edutrack:${password}@localhost:5432/edutrack?schema=identity`,
  `JWT_SECRET=${secret}`, 'PORT=3000', 'WEB_PORT=8080', 'WEB_ORIGIN=http://localhost:5173',
  // SIMULADO: Registro Académico local (infra/registry); the API reads it through REGISTRY_URL.
  'REGISTRY_URL=http://localhost:4010', `REGISTRY_API_KEY=${registryKey}`, '',
].join('\n'), { flag: 'wx', mode: 0o600 });
console.log('Created .env with random local secrets. Existing files are never overwritten.');
