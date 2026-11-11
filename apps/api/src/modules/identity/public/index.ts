// The only framework-free entry point other modules may import.
export const ROLES = ['STUDENT', 'TEACHER', 'INSTRUCTIONAL_DESIGNER', 'ADMIN'] as const;
export type Role = typeof ROLES[number];
export const IDENTITY_DIRECTORY = Symbol('IDENTITY_DIRECTORY');
export type Permission = 'profile:read' | 'profile:update' | 'password:change' | 'users:read' | 'users:write' | 'security:read';
export function permissionsFor(role: Role): readonly Permission[] {
  const personal: Permission[] = ['profile:read', 'profile:update', 'password:change'];
  return role === 'ADMIN' ? [...personal, 'users:read', 'users:write', 'security:read'] : personal;
}
export interface Principal { readonly id: string; readonly role: Role; readonly sessionId?: string }
export interface UserProfile extends Principal {
  readonly email: string; readonly displayName: string; readonly createdAt: string;
  readonly active: boolean; readonly version: number; readonly permissions: readonly Permission[];
}
export interface IdentityDirectory {
  listInstructors(): Promise<{ id: string; displayName: string }[]>;
  authenticate(token: string): Promise<UserProfile>;
  findPrincipal(id: string): Promise<Principal | null>;
  hasPermission(id: string, permission: Permission): Promise<boolean>;
}
