import { Module, DynamicModule } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IdentityService } from './application/identity-service';
import { PrismaUserRepository } from './infrastructure/persistence/prisma-user-repository';
import { ScryptPasswordHasher } from './infrastructure/security/scrypt-password-hasher';
import { JwtAccessTokens } from './infrastructure/security/jwt-access-tokens';
import { AuthGuard } from './infrastructure/http/auth.guard';
import { IdentityController } from './infrastructure/http/identity.controller';

export const IDENTITY_READINESS = Symbol('IDENTITY_READINESS');
@Module({})
export class IdentityModule {
  static register(config: { databaseUrl: string; jwtSecret: string }): DynamicModule {
    return { module: IdentityModule, controllers: [IdentityController], providers: [
      { provide: PrismaUserRepository, useFactory: () => new PrismaUserRepository(config.databaseUrl) },
      { provide: IdentityService, inject: [PrismaUserRepository], useFactory: async (users: PrismaUserRepository) => {
        const hasher = new ScryptPasswordHasher();
        return new IdentityService(users, hasher, new JwtAccessTokens(config.jwtSecret),
          { newId: randomUUID, now: () => new Date() }, await hasher.hash(randomUUID()));
      } },
      { provide: IDENTITY_READINESS, inject: [PrismaUserRepository],
        useFactory: (users: PrismaUserRepository) => ({ check: () => users.ping() }) },
      AuthGuard,
    ], exports: [IDENTITY_READINESS] };
  }
}
