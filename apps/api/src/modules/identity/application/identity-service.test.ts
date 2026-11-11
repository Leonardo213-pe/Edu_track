import { beforeEach, describe, expect, it, vi } from 'vitest';
import { User } from '../domain/user';
import { IdentityService } from './identity-service';
import type { UserRepository } from './ports';
const admin = { id: 'admin', role: 'ADMIN' as const };
const record = new User('user', 'ana@example.test', 'Ana', 'hash', 'STUDENT', new Date('2026-11-10'));
let users: UserRepository;
const passwords = { hash: vi.fn(async () => 'hash'), verify: vi.fn(async () => true) };
const tokens = { issue: vi.fn(async () => 'jwt'), verify: vi.fn(async () => 'user') };
let service: IdentityService;
beforeEach(() => {
  vi.resetAllMocks();
  passwords.hash.mockResolvedValue('hash'); passwords.verify.mockResolvedValue(true);
  tokens.issue.mockResolvedValue('jwt'); tokens.verify.mockResolvedValue('user');
  users = { findByEmail: vi.fn(async () => null), findById: vi.fn(async () => record),
    create: vi.fn(async () => {}), list: vi.fn(async () => [record]) };
  service = new IdentityService(users, passwords, tokens, { newId: () => 'new-id', now: () => new Date('2026-11-10') }, 'dummy');
});
describe('identity use cases', () => {
  it('creates a user and stores only the hashed password', async () => {
    const profile = await service.createUser(admin, { email: 'ANA@EXAMPLE.TEST', displayName: 'Ana', password: 'a-long-password', role: 'STUDENT' });
    expect(profile.email).toBe('ana@example.test'); expect(profile).not.toHaveProperty('passwordHash');
    expect(passwords.hash).toHaveBeenCalledWith('a-long-password');
    expect(users.create).toHaveBeenCalledWith(expect.objectContaining({ passwordHash: 'hash' }));
  });
  it.each(['STUDENT', 'TEACHER', 'INSTRUCTIONAL_DESIGNER'] as const)('denies %s administration in the application layer', async role => {
    const actor = { id: 'other', role };
    await expect(service.createUser(actor, { email: 'a@b.test', displayName: 'A', password: 'a-long-password', role: 'ADMIN' })).rejects.toThrow('FORBIDDEN');
    await expect(service.listUsers(actor)).rejects.toThrow('FORBIDDEN');
    expect(users.create).not.toHaveBeenCalled(); expect(users.list).not.toHaveBeenCalled();
  });
  it('rejects duplicate email', async () => {
    vi.mocked(users.findByEmail).mockResolvedValue(record);
    await expect(service.createUser(admin, { email: record.email, displayName: 'A', password: 'a-long-password', role: 'ADMIN' })).rejects.toThrow('EMAIL_EXISTS');
  });
  it('issues a short-lived token after validating credentials', async () => {
    vi.mocked(users.findByEmail).mockResolvedValue(record);
    expect(await service.login('ANA@example.test', 'password')).toEqual({ accessToken: 'jwt', expiresIn: 900, user: record.profile() });
    expect(tokens.issue).toHaveBeenCalledWith(record.id);
  });
  it('uses a dummy hash for unknown users and returns the same error as a wrong password', async () => {
    await expect(service.login('none@example.test', 'password')).rejects.toThrow('INVALID_CREDENTIALS');
    expect(passwords.verify).toHaveBeenCalledWith('password', 'dummy');
    vi.mocked(users.findByEmail).mockResolvedValue(record); passwords.verify.mockResolvedValue(false);
    await expect(service.login(record.email, 'wrong')).rejects.toThrow('INVALID_CREDENTIALS');
    expect(tokens.issue).not.toHaveBeenCalled();
  });
  it('resolves current profile and principal from persistence', async () => {
    expect(await service.authenticate('jwt')).toEqual(record.profile());
    expect(await service.findPrincipal(record.id)).toEqual({ id: record.id, role: record.role });
    vi.mocked(users.findById).mockResolvedValue(null);
    expect(await service.findPrincipal('missing')).toBeNull();
    await expect(service.authenticate('jwt')).rejects.toThrow('INVALID_CREDENTIALS');
  });
  it('rejects invalid, tampered and expired tokens', async () => {
    tokens.verify.mockRejectedValue(new Error('bad token'));
    await expect(service.authenticate('bad')).rejects.toThrow('INVALID_CREDENTIALS');
  });
  it('lists profiles with bounded pagination', async () => {
    expect(await service.listUsers(admin)).toEqual([record.profile()]);
    expect(users.list).toHaveBeenCalledWith(25, 0);
    for (const [limit, offset] of [[0, 0], [101, 0], [1.5, 0], [25, -1], [25, 1.5]])
      await expect(service.listUsers(admin, limit, offset)).rejects.toThrow('INVALID_INPUT');
  });
});
