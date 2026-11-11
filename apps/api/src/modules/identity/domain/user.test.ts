import { describe, expect, it } from 'vitest';
import { normalizeEmail, User, validatePassword } from './user';
describe('identity domain', () => {
  it('normalizes institutional emails and exposes a safe profile', () => {
    const user = new User('id', ' ANA@Example.test ', ' Ana ', 'secret-hash', 'STUDENT', new Date('2026-11-10T00:00:00Z'));
    expect(user.profile()).toMatchObject({ id: 'id', email: 'ana@example.test', displayName: 'Ana', role: 'STUDENT', active: true, version: 0, createdAt: '2026-11-10T00:00:00.000Z' });
    expect(JSON.stringify(user.profile())).not.toContain('secret-hash');
  });
  it.each(['invalid', 'a@b', '', `${'a'.repeat(250)}@b.test`])('rejects invalid email %s', email => expect(() => normalizeEmail(email)).toThrow('INVALID_INPUT'));
  it.each(['', 'short', 'a'.repeat(129)])('rejects passwords outside the policy', password => expect(() => validatePassword(password)).toThrow('INVALID_INPUT'));
  it('accepts a long password including spaces', () => expect(() => validatePassword('Una frase larga segura')).not.toThrow());
  it('protects the final administrator but permits changes when another remains', () => {
    const user = new User('id', 'a@b.test', 'A', 'hash', 'ADMIN', new Date());
    expect(() => user.protectsLastAdmin(user.revise({ active: false }), 1)).toThrow('LAST_ADMIN');
    expect(() => user.protectsLastAdmin(user.revise({ role: 'STUDENT' }), 1)).toThrow('LAST_ADMIN');
    expect(() => user.protectsLastAdmin(user.revise({ active: false }), 2)).not.toThrow();
    expect(user.revise({ displayName: 'Nuevo' }).profile()).toMatchObject({ displayName: 'Nuevo', version: 1 });
  });
  it.each([
    ['', 'a@b.test', 'Ana', 'hash', 'ADMIN'], ['id', 'a@b.test', '', 'hash', 'ADMIN'],
    ['id', 'a@b.test', 'a'.repeat(101), 'hash', 'ADMIN'], ['id', 'a@b.test', 'Ana', '', 'ADMIN'],
    ['id', 'a@b.test', 'Ana', 'hash', 'UNKNOWN'],
  ])('rejects malformed users', (id, email, name, hash, role) => {
    expect(() => new User(id!, email!, name!, hash!, role as 'ADMIN', new Date())).toThrow('INVALID_INPUT');
  });
});
