import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { IdentityService } from '../../application/identity-service';
import { ScryptPasswordHasher } from '../security/scrypt-password-hasher';
import { JwtAccessTokens } from '../security/jwt-access-tokens';
import { PrismaUserRepository } from '../persistence/prisma-user-repository';
import { loadConfig } from '../../../../config';
import { RandomSecurityTokens } from '../security/security-tokens';

async function main(): Promise<void> {
  const [email, displayName, role = 'ADMIN'] = process.argv.slice(2);
  if (!email || !displayName || role !== 'ADMIN' || process.stdin.isTTY)
    throw new Error('Usage: user:create -- <email> <name> [role]; supply password on stdin (12-128 characters)');
  const password = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  const config = loadConfig();
  const users = new PrismaUserRepository(config.databaseUrl, config.jwtSecret);
  try {
    const identity = new IdentityService(users, new ScryptPasswordHasher(), new JwtAccessTokens(config.jwtSecret),
      { newId: randomUUID, now: () => new Date() }, 'unused-for-provisioning', new RandomSecurityTokens());
    const profile = await identity.bootstrapAdmin({ email, displayName, password });
    console.log(JSON.stringify(profile));
  } finally { await users.onModuleDestroy(); }
}
main().catch(() => { console.error('User provisioning failed. Check arguments, policy, duplicates and database access.'); process.exitCode = 1; });
