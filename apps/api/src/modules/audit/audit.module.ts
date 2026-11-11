import { DynamicModule, Module } from '@nestjs/common';
import { IDENTITY_DIRECTORY, type IdentityDirectory } from '../identity/public';
import { BearerGuard } from '../../platform/http/bearer-guard';
import { AuditService } from './application/audit-service';
import { AuditController } from './infrastructure/http/audit.controller';
import { PrismaAuditRepository } from './infrastructure/persistence/prisma-audit-repository';

@Module({})
export class AuditModule {
  static register(identityModule: DynamicModule, config: { databaseUrl: string }): DynamicModule {
    return { module: AuditModule, imports: [identityModule], controllers: [AuditController], providers: [
      { provide: PrismaAuditRepository, useFactory: () => new PrismaAuditRepository(config.databaseUrl) },
      { provide: AuditService, inject: [PrismaAuditRepository, IDENTITY_DIRECTORY], useFactory: (repo: PrismaAuditRepository, identity: IdentityDirectory) =>
        new AuditService(repo, {
          role: async id => (await identity.findPrincipal(id))?.role ?? null,
          names: async ids => new Map((await identity.findUsers(ids)).map(user => [user.id, user.displayName])),
        }) },
      BearerGuard,
    ] };
  }
}
