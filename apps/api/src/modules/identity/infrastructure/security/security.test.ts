import { describe, expect, it } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'node:crypto';
import { ScryptPasswordHasher } from './scrypt-password-hasher';
import { JwtAccessTokens } from './jwt-access-tokens';
describe('real cryptographic adapters', () => {
  it('hashes with distinct salts and checks the password', async () => {
    const adapter = new ScryptPasswordHasher();
    const first = await adapter.hash('correct password'); const second = await adapter.hash('correct password');
    expect(first).not.toBe(second); expect(first).not.toContain('correct password');
    expect(await adapter.verify('correct password', first)).toBe(true);
    expect(await adapter.verify('wrong password', first)).toBe(false);
    expect(await adapter.verify('correct password', 'scrypt$garbage')).toBe(false);
  }, 20000);
  it('validates JWT signatures, expiration, algorithm, issuer, audience and subject', async () => {
    const secret = randomBytes(48).toString('hex'); const tokens = new JwtAccessTokens(secret); const id = randomUUID();
    const sessionId = randomUUID();
    const token = await tokens.issue(id, sessionId); expect(await tokens.verify(token)).toEqual({ userId: id, sessionId });
    const signer = new JwtService({ secret });
    const options = { subject: id, jwtid: sessionId, issuer: 'edutrack-api', audience: 'edutrack-web' };
    for (const bad of [
      `${token.slice(0, -4)}xxxx`, signer.sign({}, { ...options, expiresIn: -1 }),
      signer.sign({}, { ...options, audience: 'other' }), signer.sign({}, { ...options, issuer: 'other' }),
      signer.sign({}, { ...options, algorithm: 'HS384' }), signer.sign({}, { ...options, subject: 'bad-id' }),
    ]) await expect(tokens.verify(bad)).rejects.toThrow();
  });
});
