import type { User } from '../domain/user';
export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(user: User): Promise<void>;
  list(limit: number, offset: number): Promise<User[]>;
}
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}
export interface AccessTokens {
  issue(userId: string): Promise<string>;
  verify(token: string): Promise<string>;
}
export interface Runtime { newId(): string; now(): Date }
