import 'reflect-metadata';
import { afterEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { createApplication } from '../dist/bootstrap.js';
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/edutrack_test') throw new Error('Only explicit edutrack_test DB is allowed');
const mail = { host: 'localhost', port: 1025, from: 'qa@example.test', secure: false, requireTLS: false, webOrigin: 'http://localhost:5173' };
let app: Awaited<ReturnType<typeof createApplication>> | undefined;
afterEach(async () => { await app?.close(); app = undefined; });
async function start(trustProxy?: string) {
  app = await createApplication({ databaseUrl: databaseUrl!, jwtSecret: randomBytes(48).toString('hex'), port: 3000, webOrigin: mail.webOrigin, mail, trustProxy });
  await app.init(); return app;
}
function login(from: string) {
  return request(app!.getHttpServer()).post('/api/identity/login').set('X-Forwarded-For', from).send({ email: 'nobody@example.test', password: 'wrong-password' });
}
describe('rate limiting behind a reverse proxy', () => {
  it('limits each real client separately when the proxy is trusted', async () => {
    await start('loopback');
    for (let i = 0; i < 5; i++) await login('203.0.113.10').expect(401);
    await login('203.0.113.10').expect(429);
    await login('203.0.113.20').expect(401);
  });
  it('ignores spoofed X-Forwarded-For headers when no proxy is trusted', async () => {
    await start();
    for (let i = 0; i < 5; i++) await login(`198.51.100.${i}`).expect(401);
    await login('198.51.100.99').expect(429);
  });
});
