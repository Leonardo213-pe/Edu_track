import { IdentityError } from '../domain/errors';
import { User, normalizeEmail, validatePassword } from '../domain/user';
import { permissionsFor, type DirectoryEntry, type Principal, type Role, type UserProfile, type IdentityDirectory, type Permission } from '../public';
import type { AccessTokens, IdentityData, PasswordHasher, Runtime, SecurityAction, SecurityTokens, UserRepository } from './ports';

export interface CreateUser { email: string; displayName: string; password: string; role: Role }
export interface UpdateUser { email: string; displayName: string; role: Role; active: boolean; version: number }
export class IdentityService implements IdentityDirectory {
  constructor(private readonly users: UserRepository, private readonly passwords: PasswordHasher,
    private readonly tokens: AccessTokens, private readonly runtime: Runtime, private readonly dummyHash: string,
    private readonly secrets: SecurityTokens) {}
  private async event(action: SecurityAction, actorId: string | null, userId: string | null, data: IdentityData = this.users): Promise<void> {
    await data.appendEvent({ id: this.runtime.newId(), action, actorId, userId, occurredAt: this.runtime.now() });
  }
  private async actor(data: IdentityData, principal: Principal, permission: Permission): Promise<User> {
    const user = await data.findById(principal.id);
    const session = principal.sessionId ? await data.findSession(principal.sessionId) : null;
    if (!user?.active || !permissionsFor(user.role).includes(permission) || !session || session.userId !== user.id ||
      session.revokedAt || session.expiresAt <= this.runtime.now()) throw new IdentityError('FORBIDDEN');
    return user;
  }
  private async authorize(principal: Principal, permission: Permission): Promise<void> {
    try { await this.actor(this.users, principal, permission); }
    catch (error) { await this.event('ACCESS_DENIED', principal.id, principal.id); throw error; }
  }
  private pagination(limit: number, offset: number): void {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 1000000)
      throw new IdentityError('INVALID_INPUT');
  }
  async login(email: string, password: string) {
    const user = await this.users.findByEmail(normalizeEmail(email));
    const valid = await this.passwords.verify(password, user?.passwordHash ?? this.dummyHash);
    if (!user?.active || !valid) {
      await this.event('LOGIN_FAILED', null, user?.id ?? null); throw new IdentityError('INVALID_CREDENTIALS');
    }
    return this.users.transaction(async data => {
      const current = await data.findById(user.id);
      if (!current?.active || current.passwordHash !== user.passwordHash) throw new IdentityError('INVALID_CREDENTIALS');
      const sessionId = this.runtime.newId(); const accessToken = await this.tokens.issue(current.id, sessionId);
      await data.createSession({ id: sessionId, userId: current.id, expiresAt: new Date(this.runtime.now().getTime() + 900000), revokedAt: null });
      await this.event('LOGIN_SUCCEEDED', current.id, current.id, data);
      return { accessToken, expiresIn: 900, user: current.profile() };
    });
  }
  async authenticate(token: string): Promise<UserProfile> {
    try {
      const claims = await this.tokens.verify(token); const session = await this.users.findSession(claims.sessionId);
      const user = await this.users.findById(claims.userId);
      if (!user?.active || !session || session.userId !== user.id || session.revokedAt || session.expiresAt <= this.runtime.now())
        throw new IdentityError('INVALID_CREDENTIALS');
      return { ...user.profile(), sessionId: session.id };
    } catch {
      await this.event('TOKEN_REJECTED', null, null); throw new IdentityError('INVALID_CREDENTIALS');
    }
  }
  async logout(principal: Principal): Promise<void> {
    await this.users.transaction(async data => {
      await this.actor(data, principal, 'profile:read'); await data.revokeSession(principal.sessionId!, this.runtime.now());
      await this.event('LOGOUT', principal.id, principal.id, data);
    });
  }
  async findPrincipal(id: string): Promise<Principal | null> {
    const user = await this.users.findById(id); return user?.active ? { id: user.id, role: user.role } : null;
  }
  async hasPermission(id: string, permission: Permission): Promise<boolean> {
    const principal = await this.findPrincipal(id); return !!principal && permissionsFor(principal.role).includes(permission);
  }
  private entry(user: User): DirectoryEntry {
    return { id: user.id, email: user.email, displayName: user.displayName, role: user.role, active: user.active };
  }
  private bounded(values: readonly string[]): string[] {
    const unique = [...new Set(values)]; if (unique.length > 1000) throw new IdentityError('INVALID_INPUT'); return unique;
  }
  async findUsers(ids: readonly string[]): Promise<DirectoryEntry[]> {
    const unique = this.bounded(ids); return unique.length ? (await this.users.findManyByIds(unique)).map(user => this.entry(user)) : [];
  }
  async findUsersByEmail(emails: readonly string[]): Promise<DirectoryEntry[]> {
    const normalized = this.bounded(emails).flatMap(email => { try { return [normalizeEmail(email)]; } catch { return []; } });
    return normalized.length ? (await this.users.findManyByEmails(normalized)).map(user => this.entry(user)) : [];
  }
  listInstructors(): Promise<{ id: string; displayName: string }[]> { return this.activeWithRole('TEACHER'); }
  listAdministrators(): Promise<{ id: string; displayName: string }[]> { return this.activeWithRole('ADMIN'); }
  private async activeWithRole(role: Role): Promise<{ id: string; displayName: string }[]> {
    const result: { id: string; displayName: string }[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await this.users.list(100, offset);
      result.push(...page.filter(user => user.active && user.role === role).map(user => ({ id: user.id, displayName: user.displayName })));
      if (page.length < 100) return result;
    }
  }
  private async newUser(input: CreateUser): Promise<User> {
    const email = normalizeEmail(input.email); validatePassword(input.password);
    return new User(this.runtime.newId(), email, input.displayName, await this.passwords.hash(input.password), input.role, this.runtime.now());
  }
  async bootstrapAdmin(input: Omit<CreateUser, 'role'>): Promise<UserProfile> {
    const user = await this.newUser({ ...input, role: 'ADMIN' });
    return this.users.transaction(async data => {
      if (await data.countActiveAdmins()) throw new IdentityError('FORBIDDEN');
      await data.create(user); await this.event('USER_CREATED', null, user.id, data); return user.profile();
    });
  }
  async createUser(principal: Principal, input: CreateUser): Promise<UserProfile> {
    await this.authorize(principal, 'users:write'); const user = await this.newUser(input);
    return this.users.transaction(async data => {
      await this.actor(data, principal, 'users:write'); await data.create(user);
      await this.event('USER_CREATED', principal.id, user.id, data); return user.profile();
    });
  }
  async listUsers(principal: Principal, limit = 25, offset = 0): Promise<UserProfile[]> {
    await this.authorize(principal, 'users:read'); this.pagination(limit, offset);
    return (await this.users.list(limit, offset)).map(user => user.profile());
  }
  async updateUser(principal: Principal, id: string, input: UpdateUser): Promise<UserProfile> {
    await this.authorize(principal, 'users:write');
    return this.users.transaction(async data => {
      await this.actor(data, principal, 'users:write');
      const user = await data.findById(id); if (!user) throw new IdentityError('NOT_FOUND');
      const next = user.revise(input); user.protectsLastAdmin(next, await data.countActiveAdmins());
      await data.update(next, input.version);
      if (next.role !== user.role || next.active !== user.active || next.email !== user.email) {
        await data.revokeSessions(id, this.runtime.now()); await data.removeRecoveries(id);
      }
      await this.event('USER_UPDATED', principal.id, id, data); return next.profile();
    });
  }
  async updateProfile(principal: Principal, displayName: string, version: number): Promise<UserProfile> {
    await this.authorize(principal, 'profile:update');
    return this.users.transaction(async data => {
      const user = await this.actor(data, principal, 'profile:update'); const next = user.revise({ displayName });
      await data.update(next, version); await this.event('PROFILE_UPDATED', user.id, user.id, data); return next.profile();
    });
  }
  async changePassword(principal: Principal, currentPassword: string, newPassword: string): Promise<void> {
    await this.authorize(principal, 'password:change'); validatePassword(newPassword);
    const user = (await this.users.findById(principal.id))!;
    if (!await this.passwords.verify(currentPassword, user.passwordHash)) {
      await this.event('PASSWORD_CHANGE_FAILED', user.id, user.id); throw new IdentityError('PASSWORD_MISMATCH');
    }
    const hash = await this.passwords.hash(newPassword);
    await this.users.transaction(async data => {
      const current = await this.actor(data, principal, 'password:change');
      if (current.passwordHash !== user.passwordHash) throw new IdentityError('CONFLICT');
      await data.update(current.revise({ passwordHash: hash }), current.version);
      await data.revokeSessions(user.id, this.runtime.now()); await data.removeRecoveries(user.id);
      await this.event('PASSWORD_CHANGED', user.id, user.id, data);
    });
  }
  async requestRecovery(email: string): Promise<void> {
    const normalized = normalizeEmail(email); const token = this.secrets.random(); const hash = this.secrets.digest(token);
    await this.users.transaction(async data => {
      const user = await data.findByEmail(normalized); await this.event('RECOVERY_REQUESTED', null, user?.id ?? null, data);
      if (!user?.active) return;
      const latest = await data.latestRecovery(user.id);
      if (latest && latest.expiresAt.getTime() - 900000 > this.runtime.now().getTime() - 60000) return;
      const expiresAt = new Date(this.runtime.now().getTime() + 900000);
      await data.createRecovery({ userId: user.id, tokenHash: hash, expiresAt }, { email: user.email, token, expiresAt: expiresAt.toISOString() });
    });
  }
  async resetPassword(token: string, password: string): Promise<void> {
    validatePassword(password); if (!/^[a-f0-9]{64}$/.test(token)) throw new IdentityError('INVALID_RESET');
    const hash = this.secrets.digest(token); const record = await this.users.findRecovery(hash);
    if (!record || record.expiresAt <= this.runtime.now()) throw new IdentityError('INVALID_RESET');
    const passwordHash = await this.passwords.hash(password);
    await this.users.transaction(async data => {
      const recovery = await data.findRecovery(hash); const user = recovery ? await data.findById(recovery.userId) : null;
      if (!recovery || recovery.expiresAt <= this.runtime.now() || !user?.active) throw new IdentityError('INVALID_RESET');
      await data.update(user.revise({ passwordHash }), user.version);
      await data.removeRecoveries(user.id); await data.revokeSessions(user.id, this.runtime.now());
      await this.event('PASSWORD_RESET', user.id, user.id, data);
    });
  }
  async securityEvents(principal: Principal, limit = 25, offset = 0) {
    await this.authorize(principal, 'security:read'); this.pagination(limit, offset); return this.users.listEvents(limit, offset);
  }
}
