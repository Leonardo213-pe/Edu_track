import { IdentityError } from '../domain/errors';
import { User, normalizeEmail, validatePassword } from '../domain/user';
import type { Principal, Role, UserProfile, IdentityDirectory } from '../public';
import type { AccessTokens, PasswordHasher, Runtime, UserRepository } from './ports';

export class IdentityService implements IdentityDirectory {
  constructor(private readonly users: UserRepository, private readonly passwords: PasswordHasher,
    private readonly tokens: AccessTokens, private readonly runtime: Runtime, private readonly dummyHash: string) {}

  async login(email: string, password: string): Promise<{ accessToken: string; expiresIn: number; user: UserProfile }> {
    const user = await this.users.findByEmail(normalizeEmail(email));
    // Unknown users pay the same password derivation cost.
    const valid = await this.passwords.verify(password, user?.passwordHash ?? this.dummyHash);
    if (!user || !valid) throw new IdentityError('INVALID_CREDENTIALS');
    return { accessToken: await this.tokens.issue(user.id), expiresIn: 900, user: user.profile() };
  }
  async authenticate(token: string): Promise<UserProfile> {
    let id: string;
    try { id = await this.tokens.verify(token); } catch { throw new IdentityError('INVALID_CREDENTIALS'); }
    const user = await this.users.findById(id);
    if (!user) throw new IdentityError('INVALID_CREDENTIALS');
    return user.profile();
  }
  async findPrincipal(id: string): Promise<Principal | null> {
    const user = await this.users.findById(id);
    return user ? { id: user.id, role: user.role } : null;
  }
  async createUser(actor: Principal, input: { email: string; displayName: string; password: string; role: Role }): Promise<UserProfile> {
    this.requireAdmin(actor);
    const email = normalizeEmail(input.email);
    validatePassword(input.password);
    if (await this.users.findByEmail(email)) throw new IdentityError('EMAIL_EXISTS');
    const user = new User(this.runtime.newId(), email, input.displayName,
      await this.passwords.hash(input.password), input.role, this.runtime.now());
    await this.users.create(user);
    return user.profile();
  }
  async listUsers(actor: Principal, limit = 25, offset = 0): Promise<UserProfile[]> {
    this.requireAdmin(actor);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0)
      throw new IdentityError('INVALID_INPUT');
    return (await this.users.list(limit, offset)).map(user => user.profile());
  }
  private requireAdmin(actor: Principal): void {
    if (actor.role !== 'ADMIN') throw new IdentityError('FORBIDDEN');
  }
}
