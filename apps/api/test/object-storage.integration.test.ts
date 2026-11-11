import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { S3BlobStore } from '../dist/platform/storage/blob-store.js';
import { LocalSubmissionStorage } from '../dist/modules/submissions/infrastructure/storage/local-submission-storage.js';
import { LocalCourseStorage } from '../dist/modules/courses/infrastructure/storage/local-course-storage.js';
import { BlobAnchorStore } from '../dist/modules/audit/infrastructure/anchoring/blob-anchor-store.js';

// Real S3-compatible server (MinIO locally; Cloudflare R2 in the Render deployment). Skipped without S3_TEST_ENDPOINT.
const endpoint = process.env.S3_TEST_ENDPOINT;
const s3 = { endpoint: endpoint ?? '', bucket: process.env.S3_TEST_BUCKET ?? 'edutrack-test', region: process.env.S3_TEST_REGION ?? 'us-east-1',
  accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? '', secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? '' };

describe.skipIf(!endpoint)('S3-compatible object storage', () => {
  it('signs put/get/list/delete requests the server accepts and rejects a wrong secret', async () => {
    const store = new S3BlobStore(s3); const key = `qa/${randomUUID()}.txt`;
    await store.put(key, Buffer.from('hola ñandú'), 'text/plain');
    expect(Buffer.from((await store.get(key))!).toString('utf8')).toBe('hola ñandú');
    expect(await store.list('qa/')).toContain(key);
    await store.delete(key); expect(await store.get(key)).toBeNull();
    await expect(new S3BlobStore({ ...s3, secretAccessKey: 'wrong-secret' }).get(key)).rejects.toThrow(/HTTP 403/);
  });
  it('keeps course and submission files in the bucket with the same validation as the local driver', async () => {
    const submissions = LocalSubmissionStorage.create({ driver: 's3', s3 }, 'unused');
    const stored = await submissions.put({ bytes: Buffer.from('Informe de avance en texto plano.'), filename: 'informe.txt', mimeType: 'text/plain' });
    expect(Buffer.from(await submissions.read(stored.key)).toString()).toBe('Informe de avance en texto plano.');
    await expect(submissions.put({ bytes: Buffer.from('no es pdf'), filename: 'x.pdf', mimeType: 'application/pdf' })).rejects.toMatchObject({ code: 'FILE_REJECTED' });
    await submissions.remove(stored.key); await expect(submissions.read(stored.key)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const courses = LocalCourseStorage.create({ driver: 's3', s3 }, 'unused');
    const material = await courses.put({ bytes: Buffer.from('Lectura'), filename: 'lectura.txt', mimeType: 'text/plain' });
    expect(Buffer.from(await courses.read(material.key)).toString()).toBe('Lectura'); await courses.remove(material.key);
  });
  it('without static keys, signs with temporary credentials from the container credentials endpoint (ECS task role)', async () => {
    const { createServer } = await import('node:http');
    let served = 0;
    // Explicit double of the ECS credentials endpoint; the S3 server is real.
    const server = createServer((_request, response) => { served++; response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ AccessKeyId: s3.accessKeyId, SecretAccessKey: s3.secretAccessKey, Token: 'qa-session-token', Expiration: new Date(Date.now() + 3600_000).toISOString() })); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const store = new S3BlobStore({ ...s3, accessKeyId: '', secretAccessKey: '' }, () => new Date(), { AWS_CONTAINER_CREDENTIALS_FULL_URI: `http://127.0.0.1:${port}/creds` });
      const key = `qa/${randomUUID()}.txt`;
      await store.put(key, Buffer.from('rol de tarea'), 'text/plain');
      expect(Buffer.from((await store.get(key))!).toString()).toBe('rol de tarea'); await store.delete(key);
      expect(served).toBe(1); // cached until close to expiry
      await expect(new S3BlobStore({ ...s3, accessKeyId: '', secretAccessKey: '' }, () => new Date(), { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'http://evil.example/creds' }).get(key))
        .rejects.toThrow('loopback');
    } finally { server.close(); }
  });
  it('stores audit anchors as ordered objects and returns the latest', async () => {
    const anchors = new BlobAnchorStore(new S3BlobStore({ ...s3, bucket: s3.bucket }));
    const id = String(Date.now()); // always greater than anchors left by previous runs in the same bucket
    await anchors.append({ entryId: id, hash: 'a'.repeat(64), anchoredAt: new Date().toISOString() });
    expect(await anchors.last()).toMatchObject({ entryId: id, hash: 'a'.repeat(64) });
  });
});
