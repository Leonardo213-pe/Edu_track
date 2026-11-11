import { Module, DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { IdentityErrorFilter } from './infrastructure/http/identity-error.filter';
import { randomUUID } from 'node:crypto';
import { IdentityService } from './application/identity-service';
import { PrismaUserRepository } from './infrastructure/persistence/prisma-user-repository';
import { ScryptPasswordHasher } from './infrastructure/security/scrypt-password-hasher';
import { JwtAccessTokens } from './infrastructure/security/jwt-access-tokens';
import { AuthGuard } from './infrastructure/http/auth.guard';
import { IdentityController } from './infrastructure/http/identity.controller';
import { RandomSecurityTokens } from './infrastructure/security/security-tokens';
import { RecoveryDispatcher } from './infrastructure/notifications/recovery-dispatcher';
import { SmtpResetMailer, type MailConfig } from './infrastructure/notifications/smtp-reset-mailer';
import { IDENTITY_DIRECTORY } from './public';

export type { MailConfig };
export const IDENTITY_READINESS = Symbol('IDENTITY_READINESS');
@Module({})
export class IdentityModule {
  static register(config: { databaseUrl: string; jwtSecret: string; mail: MailConfig }): DynamicModule {
    return { module: IdentityModule, controllers: [IdentityController], providers: [
      { provide: PrismaUserRepository, useFactory: () => new PrismaUserRepository(config.databaseUrl, config.jwtSecret) },
      { provide: IdentityService, inject: [PrismaUserRepository], useFactory: async (users: PrismaUserRepository) => {
        const hasher = new ScryptPasswordHasher();
        return new IdentityService(users, hasher, new JwtAccessTokens(config.jwtSecret),
          { newId: randomUUID, now: () => new Date() }, await hasher.hash(randomUUID()), new RandomSecurityTokens());
      } },
      { provide: IDENTITY_READINESS, inject: [PrismaUserRepository],
        useFactory: (users: PrismaUserRepository) => ({ check: () => users.ping() }) },
      { provide: IDENTITY_DIRECTORY, useExisting: IdentityService },
      { provide: RecoveryDispatcher, inject: [PrismaUserRepository], useFactory: (users: PrismaUserRepository) => {
        const mailer = new SmtpResetMailer(config.mail); // one pooled transport for the life of the process
        return new RecoveryDispatcher(() => users.dispatchRecovery(mailer));
      } },
      AuthGuard, { provide: APP_FILTER, useClass: IdentityErrorFilter },
    ], exports: [IDENTITY_READINESS, IDENTITY_DIRECTORY] };
  }
}
