import { DynamicModule, Module } from '@nestjs/common';
import { IDENTITY_DIRECTORY, type IdentityDirectory } from '../identity/public';
import { BearerGuard } from '../../platform/http/bearer-guard';
import { AuditService } from './application/audit-service';
import { AuditController } from './infrastructure/http/audit.controller';
import { AuditAnchorJob } from './infrastructure/anchoring/audit-anchor-job';
import { FileAnchorStore } from './infrastructure/anchoring/file-anchor-store';
import { PrismaAuditRepository } from './infrastructure/persistence/prisma-audit-repository';
import { AUDIT_ANCHOR_STATUS } from './public';

@Module({})
export class AuditModule {
  static register(identityModule: DynamicModule, config: { databaseUrl: string; anchorDir?: string; anchorIntervalMs?: number }): DynamicModule {
    return { module: AuditModule, imports: [identityModule], controllers: [AuditController], providers: [
      { provide: PrismaAuditRepository, useFactory: () => new PrismaAuditRepository(config.databaseUrl) },
      { provide: AuditService, inject: [PrismaAuditRepository, IDENTITY_DIRECTORY], useFactory: (repo: PrismaAuditRepository, identity: IdentityDirectory) =>
        new AuditService(repo, {
          role: async id => (await identity.findPrincipal(id))?.role ?? null,
          names: async ids => new Map((await identity.findUsers(ids)).map(user => [user.id, user.displayName])),
        }, config.anchorDir ? new FileAnchorStore(config.anchorDir) : undefined) },
      { provide: AuditAnchorJob, inject: [AuditService], useFactory: (audit: AuditService) => new AuditAnchorJob(audit, config.anchorIntervalMs) },
      { provide: AUDIT_ANCHOR_STATUS, useExisting: AuditService }, BearerGuard,
    ], exports: [AUDIT_ANCHOR_STATUS] };
  }
}
