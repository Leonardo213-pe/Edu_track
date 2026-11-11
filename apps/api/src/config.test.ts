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
    expect(loadConfig({ ...base, ALLOW_TEST_ENROLLMENTS: 'false' }).academic).toEqual({ storageRoot: undefined });
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow('JWT_SECRET');
  });
});
