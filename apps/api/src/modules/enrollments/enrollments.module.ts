import { DynamicModule, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { IDENTITY_DIRECTORY, type IdentityDirectory } from '../identity/public';
import { SYSTEM_ACTOR_ID } from '../audit/public';
import { EnrollmentService } from './application/enrollment-service';
import { RegistrySyncService } from './application/registry-sync-service';
import type { EnrollmentDirectory } from './application/ports';
import { MAX_RETRIES } from './domain/registry';
import { EnrollmentAuthGuard, EnrollmentController } from './infrastructure/http/enrollment.controller';
import { RegistrySyncController } from './infrastructure/http/registry-sync.controller';
import { RegistrySyncScheduler } from './infrastructure/jobs/registry-sync-scheduler';
import { PrismaEnrollmentRepository } from './infrastructure/persistence/prisma-enrollment-repository';
import { HttpAcademicRegistry, type RegistryHttpConfig } from './infrastructure/registry/http-academic-registry';
import { ENROLLMENT_ACCESS, REGISTRY_SECTIONS, REGISTRY_SYNC_STATUS } from './public';

export interface EnrollmentsConfig {
  databaseUrl: string;
  /** Academic Registry (SIMULATED in local Compose). Without url/apiKey the scheduler stays idle. */
  registry?: RegistryHttpConfig & { retryBaseMs?: number; schedulerIntervalMs?: number };
}
const directoryOf = (identity: IdentityDirectory): EnrollmentDirectory => ({ byIds: ids => identity.findUsers(ids), byEmails: emails => identity.findUsersByEmail(emails) });

@Module({})
export class EnrollmentsModule {
  static register(identityModule: DynamicModule, config: EnrollmentsConfig): DynamicModule {
    return { module: EnrollmentsModule, imports: [identityModule], controllers: [EnrollmentController, RegistrySyncController], providers: [
      { provide: PrismaEnrollmentRepository, useFactory: () => new PrismaEnrollmentRepository(config.databaseUrl) },
      { provide: EnrollmentService, inject: [PrismaEnrollmentRepository, IDENTITY_DIRECTORY],
        useFactory: (repo: PrismaEnrollmentRepository, identity: IdentityDirectory) => new EnrollmentService(repo, directoryOf(identity),
          { id: randomUUID, now: () => new Date().toISOString() }) },
      { provide: RegistrySyncService, inject: [PrismaEnrollmentRepository, IDENTITY_DIRECTORY],
        useFactory: (repo: PrismaEnrollmentRepository, identity: IdentityDirectory) => new RegistrySyncService(repo,
          new HttpAcademicRegistry(config.registry ?? {}), directoryOf(identity),
          { id: randomUUID, now: () => new Date().toISOString(), sleep: ms => sleep(ms) },
          { retries: MAX_RETRIES, baseDelayMs: config.registry?.retryBaseMs ?? 2000, systemActorId: SYSTEM_ACTOR_ID }) },
      { provide: RegistrySyncScheduler, inject: [RegistrySyncService],
        useFactory: (sync: RegistrySyncService) => new RegistrySyncScheduler(sync, config.registry?.schedulerIntervalMs) },
      { provide: ENROLLMENT_ACCESS, useExisting: EnrollmentService },
      { provide: REGISTRY_SECTIONS, useExisting: RegistrySyncService },
      { provide: REGISTRY_SYNC_STATUS, useExisting: RegistrySyncService }, EnrollmentAuthGuard,
    ], exports: [ENROLLMENT_ACCESS, REGISTRY_SECTIONS, REGISTRY_SYNC_STATUS] };
  }
}
