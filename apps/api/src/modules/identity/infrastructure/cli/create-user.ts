import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { IdentityService } from '../../application/identity-service';
import { ROLES, type Role } from '../../public';
import { ScryptPasswordHasher } from '../security/scrypt-password-hasher';
import { JwtAccessTokens } from '../security/jwt-access-tokens';
import { PrismaUserRepository } from '../persistence/prisma-user-repository';
import { loadConfig } from '../../../../config';

async function main(): Promise<void> {
  const [email, displayName, role = 'ADMIN'] = process.argv.slice(2);
  if (!email || !displayName || !ROLES.includes(role as Role) || process.stdin.isTTY)
    throw new Error('Usage: user:create -- <email> <name> [role]; supply password on stdin (12-128 characters)');
  const password = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  const config = loadConfig();
  const users = new PrismaUserRepository(config.databaseUrl);
  try {
    const identity = new IdentityService(users, new ScryptPasswordHasher(), new JwtAccessTokens(config.jwtSecret),
      { newId: randomUUID, now: () => new Date() }, 'unused-for-provisioning');
    const profile = await identity.createUser({ id: 'local-operator', role: 'ADMIN' },
      { email, displayName, role: role as Role, password });
    console.log(JSON.stringify(profile));
  } finally { await users.onModuleDestroy(); }
}
main().catch(() => { console.error('User provisioning failed. Check arguments, policy, duplicates and database access.'); process.exitCode = 1; });
