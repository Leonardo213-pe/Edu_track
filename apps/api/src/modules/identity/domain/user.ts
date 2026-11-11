import { ROLES, permissionsFor, type Role, type UserProfile } from '../public';
import { IdentityError } from './errors';

export function normalizeEmail(email: string): string {
  const value = email.trim().toLowerCase();
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new IdentityError('INVALID_INPUT');
  return value;
}
export function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 128) throw new IdentityError('INVALID_INPUT');
}
export class User {
  readonly email: string;
  readonly displayName: string;
  constructor(readonly id: string, email: string, displayName: string,
    readonly passwordHash: string, readonly role: Role, readonly createdAt: Date,
    readonly active = true, readonly version = 0) {
    this.email = normalizeEmail(email);
    this.displayName = displayName.trim();
    if (!id || !passwordHash || !ROLES.includes(role) || !this.displayName || this.displayName.length > 100 || typeof active !== 'boolean' || !Number.isInteger(version) || version < 0)
      throw new IdentityError('INVALID_INPUT');
  }
  profile(): UserProfile {
    return { id: this.id, email: this.email, displayName: this.displayName,
      role: this.role, createdAt: this.createdAt.toISOString(), active: this.active,
      version: this.version, permissions: permissionsFor(this.role) };
  }
  revise(input: { email?: string; displayName?: string; role?: Role; active?: boolean; passwordHash?: string }): User {
    return new User(this.id, input.email ?? this.email, input.displayName ?? this.displayName,
      input.passwordHash ?? this.passwordHash, input.role ?? this.role, this.createdAt,
      input.active ?? this.active, this.version + 1);
  }
  protectsLastAdmin(next: User, activeAdmins: number): void {
    if (this.active && this.role === 'ADMIN' && (!next.active || next.role !== 'ADMIN') && activeAdmins <= 1)
      throw new IdentityError('LAST_ADMIN');
  }
}
