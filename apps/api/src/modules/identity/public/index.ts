// The only framework-free entry point other modules may import.
export const ROLES = ['STUDENT', 'TEACHER', 'INSTRUCTIONAL_DESIGNER', 'ADMIN'] as const;
export type Role = typeof ROLES[number];
export interface Principal { readonly id: string; readonly role: Role }
export interface UserProfile extends Principal {
  readonly email: string; readonly displayName: string; readonly createdAt: string;
}
export interface IdentityDirectory {
  findPrincipal(id: string): Promise<Principal | null>;
}
