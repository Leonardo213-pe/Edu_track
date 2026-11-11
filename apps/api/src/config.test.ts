import { describe, expect, it } from 'vitest';
import { loadConfig, parseTrustProxy } from './config';
const base = { DATABASE_URL: 'postgresql://user@localhost:5432/db', JWT_SECRET: 'x'.repeat(48) };
describe('runtime configuration', () => {
  it('parses the trusted proxy setting used to identify clients behind Nginx', () => {
    expect(parseTrustProxy(undefined)).toBeUndefined(); expect(parseTrustProxy(' ')).toBeUndefined();
    expect(parseTrustProxy('false')).toBe(false); expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('loopback, uniquelocal')).toBe('loopback, uniquelocal'); expect(parseTrustProxy('172.16.0.0/12')).toBe('172.16.0.0/12');
    for (const unsafe of ['true', 'loopback;rm', '$(x)']) expect(() => parseTrustProxy(unsafe)).toThrow('Invalid TRUST_PROXY');
    expect(loadConfig({ ...base, TRUST_PROXY: 'uniquelocal' }).trustProxy).toBe('uniquelocal');
  });
  it('rejects removed enrollment fixtures and invalid secrets', () => {
    expect(() => loadConfig({ ...base, ALLOW_TEST_ENROLLMENTS: 'true' })).toThrow('fixtures were removed');
    expect(() => loadConfig({ ...base, ENROLLMENT_FIXTURES_FILE: '/tmp/x.json' })).toThrow('fixtures were removed');
    expect(loadConfig({ ...base, ALLOW_TEST_ENROLLMENTS: 'false' }).academic).toEqual({ storageRoot: undefined, submissionStorageRoot: undefined });
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow('JWT_SECRET');
  });
  it('selects local or S3-compatible object storage and rejects incomplete S3 settings', () => {
    expect(loadConfig(base).storage).toEqual({ driver: 'local' });
    const s3 = { STORAGE_DRIVER: 's3', S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com', S3_BUCKET: 'edutrack', S3_ACCESS_KEY_ID: 'id', S3_SECRET_ACCESS_KEY: 'secret' };
    expect(loadConfig({ ...base, ...s3 }).storage).toEqual({ driver: 's3', s3: { endpoint: s3.S3_ENDPOINT, bucket: 'edutrack', region: 'auto', accessKeyId: 'id', secretAccessKey: 'secret' } });
    expect(() => loadConfig({ ...base, ...s3, S3_BUCKET: '' })).toThrow('requires S3_ENDPOINT');
    expect(() => loadConfig({ ...base, ...s3, S3_SECRET_ACCESS_KEY: '' })).toThrow('both or none');
    expect(loadConfig({ ...base, ...s3, S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '' }).storage).toMatchObject({ driver: 's3', s3: { accessKeyId: '' } });
    expect(() => loadConfig({ ...base, STORAGE_DRIVER: 'ftp' })).toThrow('local or s3');
  });
  it('configures the (SIMULATED) Academic Registry only with a URL and a strong key together', () => {
    expect(loadConfig(base).registry).toEqual({ url: undefined, apiKey: undefined, retryBaseMs: undefined, schedulerIntervalMs: undefined, timeoutMs: undefined });
    expect(loadConfig({ ...base, REGISTRY_URL: 'http://registry:4010', REGISTRY_API_KEY: 'k'.repeat(16), REGISTRY_RETRY_BASE_MS: '50', ALERT_INTERVAL_MS: '1000' }))
      .toMatchObject({ registry: { url: 'http://registry:4010', retryBaseMs: 50 }, alertIntervalMs: 1000 });
    expect(() => loadConfig({ ...base, REGISTRY_URL: 'http://registry:4010' })).toThrow('set together');
    expect(() => loadConfig({ ...base, REGISTRY_URL: 'ftp://registry', REGISTRY_API_KEY: 'k'.repeat(16) })).toThrow('Invalid REGISTRY_URL');
    expect(() => loadConfig({ ...base, REGISTRY_URL: 'http://registry', REGISTRY_API_KEY: 'short' })).toThrow('16 characters');
    expect(() => loadConfig({ ...base, REGISTRY_RETRY_BASE_MS: '-1' })).toThrow('REGISTRY_RETRY_BASE_MS');
  });
});
