import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IdentityService } from './identity-service';
import { User } from '../domain/user';
import { IdentityError } from '../domain/errors';
import type { UserRepository, SessionRecord, RecoveryRecord, SecurityEvent, ResetMessage } from './ports';
const admin = { id: 'admin', role: 'ADMIN' as const, sessionId: 'admin-session' };
const student = { id: 'student', role: 'STUDENT' as const, sessionId: 'student-session' };
let now: Date, users: Map<string, User>, sessions: Map<string, SessionRecord>, recoveries: Map<string, RecoveryRecord>;
let events: SecurityEvent[], messages: ResetMessage[], repo: UserRepository, service: IdentityService;
const hasher = { hash: vi.fn(async () => 'new-hash'), verify: vi.fn(async () => true) };
const tokens = { issue: vi.fn(async () => 'jwt'), verify: vi.fn(async () => ({ userId: 'student', sessionId: 'student-session' })) };
const raw = 'a'.repeat(64);
beforeEach(() => {
  vi.resetAllMocks(); hasher.hash.mockResolvedValue('new-hash'); hasher.verify.mockResolvedValue(true);
  tokens.issue.mockResolvedValue('jwt'); tokens.verify.mockResolvedValue({ userId: 'student', sessionId: 'student-session' });
  now = new Date('2026-11-11T00:00:00Z'); users = new Map(); sessions = new Map(); recoveries = new Map(); events = []; messages = [];
  for (const actor of [admin, student]) {
    users.set(actor.id, new User(actor.id, `${actor.id}@example.test`, actor.id, 'old-hash', actor.role, now));
    sessions.set(actor.sessionId, { id: actor.sessionId, userId: actor.id, expiresAt: new Date(+now + 900000), revokedAt: null });
  }
  // Explicit unit-test double. Production and integration tests use PostgreSQL.
  repo = {
    findById: async id => users.get(id) ?? null,
    findManyByIds: async ids => [...users.values()].filter(user => ids.includes(user.id)),
    findManyByEmails: async emails => [...users.values()].filter(user => emails.includes(user.email)),
    findByEmail: async email => [...users.values()].find(user => user.email === email) ?? null,
    create: async user => { if ([...users.values()].some(existing => existing.email === user.email)) throw new IdentityError('EMAIL_EXISTS'); users.set(user.id, user); },
    update: async (user, version) => { if (users.get(user.id)?.version !== version) throw new IdentityError('CONFLICT'); users.set(user.id, user); },
    list: async (limit, offset) => [...users.values()].slice(offset, offset + limit),
    countActiveAdmins: async () => [...users.values()].filter(user => user.active && user.role === 'ADMIN').length,
    findSession: async id => sessions.get(id) ?? null, createSession: async record => { sessions.set(record.id, record); },
    revokeSession: async (id, at) => { const record = sessions.get(id); if (record) record.revokedAt = at; },
    revokeSessions: async (id, at) => { for (const record of sessions.values()) if (record.userId === id) record.revokedAt = at; },
    findRecovery: async hash => recoveries.get(hash) ?? null,
    latestRecovery: async id => [...recoveries.values()].find(record => record.userId === id) ?? null,
    createRecovery: async (record, message) => { recoveries.set(record.tokenHash, record); messages.push(message); },
    removeRecoveries: async id => { for (const [hash, record] of recoveries) if (record.userId === id) recoveries.delete(hash); },
    appendEvent: async event => { events.push(event); }, listEvents: async (limit, offset) => events.slice(offset, offset + limit),
    transaction: async work => work(repo),
  };
  let id = 0;
  service = new IdentityService(repo, hasher, tokens, { newId: () => `id-${++id}`, now: () => now }, 'dummy', { random: () => raw, digest: token => `hash:${token}` });
});
describe('identity application with explicit ports', () => {
  it('creates users and prevents duplicate credentials', async () => {
    const input = { email: 'NEW@EXAMPLE.TEST', displayName: 'Nueva', password: 'a-long-password', role: 'TEACHER' as const };
    const profile = await service.createUser(admin, input); expect(profile.email).toBe('new@example.test');
    expect(users.get(profile.id)?.passwordHash).toBe('new-hash'); expect(profile).not.toHaveProperty('passwordHash');
    await expect(service.createUser(admin, input)).rejects.toThrow('EMAIL_EXISTS');
  });
  it.each(['STUDENT', 'TEACHER', 'INSTRUCTIONAL_DESIGNER'] as const)('denies %s administration including a forged role claim', async role => {
    users.set('student', users.get('student')!.revise({ role }));
    const forged = { ...student, role: 'ADMIN' as const };
    await expect(service.listUsers(forged)).rejects.toThrow('FORBIDDEN');
    await expect(service.securityEvents(forged)).rejects.toThrow('FORBIDDEN');
    expect(events.some(event => event.action === 'ACCESS_DENIED')).toBe(true);
  });
  it('requires an active owned session and current user', async () => {
    for (const actor of [{ ...admin, sessionId: undefined }, { ...admin, sessionId: 'student-session' }, { ...admin, id: 'missing' }])
      await expect(service.listUsers(actor)).rejects.toThrow('FORBIDDEN');
    sessions.get(admin.sessionId)!.revokedAt = now; await expect(service.listUsers(admin)).rejects.toThrow('FORBIDDEN');
    sessions.get(admin.sessionId)!.revokedAt = null; sessions.get(admin.sessionId)!.expiresAt = now;
    await expect(service.listUsers(admin)).rejects.toThrow('FORBIDDEN');
  });
  it('logs successful and rejected logins and uses the dummy hash for unknown users', async () => {
    const result = await service.login('STUDENT@EXAMPLE.TEST', 'password'); expect(result.expiresIn).toBe(900);
    expect(tokens.issue).toHaveBeenCalledWith('student', expect.any(String));
    await expect(service.login('missing@example.test', 'wrong')).rejects.toThrow('INVALID_CREDENTIALS');
    expect(hasher.verify).toHaveBeenLastCalledWith('wrong', 'dummy');
    hasher.verify.mockResolvedValue(false); await expect(service.login('student@example.test', 'wrong')).rejects.toThrow('INVALID_CREDENTIALS');
    hasher.verify.mockResolvedValue(true); users.set('student', users.get('student')!.revise({ active: false }));
    await expect(service.login('student@example.test', 'password')).rejects.toThrow('INVALID_CREDENTIALS');
  });
  it('checks server sessions, rejects revoked/expired/unknown tokens and logs logout', async () => {
    expect(await service.authenticate('jwt')).toMatchObject({ id: 'student', sessionId: student.sessionId });
    await service.logout(student); await expect(service.authenticate('jwt')).rejects.toThrow('INVALID_CREDENTIALS');
    sessions.get(student.sessionId)!.revokedAt = null; sessions.get(student.sessionId)!.expiresAt = now;
    await expect(service.authenticate('jwt')).rejects.toThrow('INVALID_CREDENTIALS');
    sessions.delete(student.sessionId); await expect(service.authenticate('jwt')).rejects.toThrow('INVALID_CREDENTIALS');
    tokens.verify.mockRejectedValue(new Error('expired')); await expect(service.authenticate('bad')).rejects.toThrow('INVALID_CREDENTIALS');
  });
  it('publishes active principals and permissions without framework dependencies', async () => {
    expect(await service.hasPermission(admin.id, 'users:write')).toBe(true);
    expect(await service.hasPermission(student.id, 'users:write')).toBe(false);
    expect(await service.findPrincipal('missing')).toBeNull();
    users.set('student', users.get('student')!.revise({ active: false })); expect(await service.findPrincipal('student')).toBeNull();
  });
  it('exposes a minimal directory by IDs and normalized emails without credentials', async () => {
    expect(await service.findUsers([])).toEqual([]); expect(await service.findUsersByEmail(['not-an-email'])).toEqual([]);
    const [entry] = await service.findUsers(['student', 'student', 'missing']);
    expect(entry).toEqual({ id: 'student', email: 'student@example.test', displayName: 'student', role: 'STUDENT', active: true });
    expect(entry).not.toHaveProperty('passwordHash');
    expect((await service.findUsersByEmail([' STUDENT@example.test ', 'admin@example.test'])).map(user => user.id).sort()).toEqual(['admin', 'student']);
    await expect(service.findUsers(Array.from({ length: 1001 }, (_, index) => `id-${index}`))).rejects.toThrow('INVALID_INPUT');
    users.set('teacher', new User('teacher', 'teacher@example.test', 'Docente', 'hash', 'TEACHER', now));
    expect(await service.listInstructors()).toEqual([{ id: 'teacher', displayName: 'Docente' }]);
    expect((await service.listAdministrators()).every(user => typeof user.id === 'string')).toBe(true);
  });
  it('bounds user and security-event pagination', async () => {
    expect(await service.listUsers(admin)).toHaveLength(2); expect(await service.securityEvents(admin)).toEqual([]);
    for (const [limit, offset] of [[0, 0], [101, 0], [1.5, 0], [25, -1], [25, 1.5], [25, 1000001]])
      await expect(service.listUsers(admin, limit, offset)).rejects.toThrow('INVALID_INPUT');
  });
  it('edits a profile, prevents lost updates and does not permit escalation through profile fields', async () => {
    expect(await service.updateProfile(student, 'Nombre nuevo', 0)).toMatchObject({ displayName: 'Nombre nuevo', role: 'STUDENT', version: 1 });
    await expect(service.updateProfile(student, 'Old edit', 0)).rejects.toThrow('CONFLICT');
  });
  it('updates role/status/email and revokes sessions and recovery links', async () => {
    await service.requestRecovery('student@example.test');
    const profile = await service.updateUser(admin, student.id, { email: 'updated@example.test', displayName: 'New', role: 'TEACHER', active: false, version: 0 });
    expect(profile.active).toBe(false); expect(sessions.get(student.sessionId)?.revokedAt).toEqual(now); expect(recoveries.size).toBe(0);
    await expect(service.updateUser(admin, 'missing', { ...profile, version: 0 })).rejects.toThrow('NOT_FOUND');
  });
  it('allows harmless administrative edits and protects the last active admin', async () => {
    const profile = users.get('admin')!.profile();
    await expect(service.updateUser(admin, admin.id, { ...profile, active: false })).rejects.toThrow('LAST_ADMIN');
    await expect(service.updateUser(admin, admin.id, { ...profile, role: 'STUDENT' })).rejects.toThrow('LAST_ADMIN');
    await service.updateUser(admin, admin.id, { ...profile, displayName: 'New admin' });
    expect(sessions.get(admin.sessionId)?.revokedAt).toBeNull();
  });
  it('changes passwords after verification and invalidates every session and recovery', async () => {
    hasher.verify.mockResolvedValue(false); await expect(service.changePassword(student, 'wrong', 'new-password-long')).rejects.toThrow('PASSWORD_MISMATCH');
    hasher.verify.mockResolvedValue(true); await service.changePassword(student, 'correct', 'new-password-long');
    expect(users.get(student.id)?.passwordHash).toBe('new-hash'); expect(sessions.get(student.sessionId)?.revokedAt).toEqual(now);
  });
  it('queues recovery privately with per-account cooldown and a generic result for unknown/inactive users', async () => {
    expect(await service.requestRecovery('missing@example.test')).toBeUndefined();
    await service.requestRecovery('student@example.test'); await service.requestRecovery('student@example.test'); expect(messages).toHaveLength(1);
    now = new Date(+now + 61000); await service.requestRecovery('student@example.test'); expect(messages).toHaveLength(2);
    users.set('student', users.get('student')!.revise({ active: false })); await service.requestRecovery('student@example.test'); expect(messages).toHaveLength(2);
  });
  it('consumes a recovery once, expires it and revokes old sessions', async () => {
    await expect(service.resetPassword(raw, 'new-password-long')).rejects.toThrow('INVALID_RESET');
    await expect(service.resetPassword('bad', 'new-password-long')).rejects.toThrow('INVALID_RESET');
    await service.requestRecovery('student@example.test'); await service.resetPassword(raw, 'new-password-long');
    expect(recoveries.size).toBe(0); expect(sessions.get(student.sessionId)?.revokedAt).toEqual(now);
    await expect(service.resetPassword(raw, 'new-password-long')).rejects.toThrow('INVALID_RESET');
    await service.requestRecovery('student@example.test'); now = new Date(+now + 900001);
    await expect(service.resetPassword(raw, 'new-password-long')).rejects.toThrow('INVALID_RESET');
  });
  it('rechecks reset state inside the transaction', async () => {
    await service.requestRecovery('student@example.test');
    const transaction = repo.transaction;
    repo.transaction = async work => { recoveries.clear(); return transaction(work); };
    await expect(service.resetPassword(raw, 'new-password-long')).rejects.toThrow('INVALID_RESET');
  });
  it('bootstraps only when there is no active administrator', async () => {
    await expect(service.bootstrapAdmin({ email: 'new@example.test', displayName: 'A', password: 'new-password-long' })).rejects.toThrow('FORBIDDEN');
    users.delete('admin'); expect((await service.bootstrapAdmin({ email: 'new@example.test', displayName: 'A', password: 'new-password-long' })).role).toBe('ADMIN');
  });
});
