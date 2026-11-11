import type { User } from '../domain/user';
export type SecurityAction = 'LOGIN_SUCCEEDED' | 'LOGIN_FAILED' | 'TOKEN_REJECTED' | 'LOGOUT' | 'ACCESS_DENIED' |
  'USER_CREATED' | 'USER_UPDATED' | 'PROFILE_UPDATED' | 'PASSWORD_CHANGED' | 'RECOVERY_REQUESTED' |
  'PASSWORD_RESET' | 'RECOVERY_DELIVERED' | 'RECOVERY_DELIVERY_FAILED' | 'PASSWORD_CHANGE_FAILED';
export interface SecurityEvent { id: string; action: SecurityAction; actorId: string | null; userId: string | null; occurredAt: Date }
export interface SessionRecord { id: string; userId: string; expiresAt: Date; revokedAt: Date | null }
export interface RecoveryRecord { tokenHash: string; userId: string; expiresAt: Date }
export interface ResetMessage { email: string; token: string; expiresAt: string }
export interface IdentityData {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  findManyByIds(ids: string[]): Promise<User[]>;
  findManyByEmails(emails: string[]): Promise<User[]>;
  create(user: User): Promise<void>;
  update(user: User, expectedVersion: number): Promise<void>;
  list(limit: number, offset: number): Promise<User[]>;
  countActiveAdmins(): Promise<number>;
  findSession(id: string): Promise<SessionRecord | null>;
  createSession(session: SessionRecord): Promise<void>;
  revokeSession(id: string, now: Date): Promise<void>;
  revokeSessions(userId: string, now: Date): Promise<void>;
  findRecovery(hash: string): Promise<RecoveryRecord | null>;
  latestRecovery(userId: string): Promise<RecoveryRecord | null>;
  createRecovery(recovery: RecoveryRecord, message: ResetMessage): Promise<void>;
  removeRecoveries(userId: string): Promise<void>;
  appendEvent(event: SecurityEvent): Promise<void>;
  listEvents(limit: number, offset: number): Promise<SecurityEvent[]>;
}
export interface UserRepository extends IdentityData { transaction<T>(work: (data: IdentityData) => Promise<T>): Promise<T> }
export interface PasswordHasher { hash(password: string): Promise<string>; verify(password: string, hash: string): Promise<boolean> }
export interface AccessTokens {
  issue(userId: string, sessionId: string): Promise<string>;
  verify(token: string): Promise<{ userId: string; sessionId: string }>;
}
export interface SecurityTokens { random(): string; digest(token: string): string }
export interface ResetMailer { send(message: ResetMessage): Promise<void> }
export interface Runtime { newId(): string; now(): Date }
