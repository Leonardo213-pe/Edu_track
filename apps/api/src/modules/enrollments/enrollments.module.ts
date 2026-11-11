import { DynamicModule, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IDENTITY_DIRECTORY, type IdentityDirectory } from '../identity/public';
import { EnrollmentService } from './application/enrollment-service';
import { EnrollmentAuthGuard, EnrollmentController } from './infrastructure/http/enrollment.controller';
import { PrismaEnrollmentRepository } from './infrastructure/persistence/prisma-enrollment-repository';
import { ENROLLMENT_ACCESS } from './public';

@Module({})
export class EnrollmentsModule {
  static register(identityModule: DynamicModule, config: { databaseUrl: string }): DynamicModule {
    return { module: EnrollmentsModule, imports: [identityModule], controllers: [EnrollmentController], providers: [
      { provide: PrismaEnrollmentRepository, useFactory: () => new PrismaEnrollmentRepository(config.databaseUrl) },
      { provide: EnrollmentService, inject: [PrismaEnrollmentRepository, IDENTITY_DIRECTORY],
        useFactory: (repo: PrismaEnrollmentRepository, identity: IdentityDirectory) => new EnrollmentService(repo,
          { byIds: ids => identity.findUsers(ids), byEmails: emails => identity.findUsersByEmail(emails) },
          { id: randomUUID, now: () => new Date().toISOString() }) },
      { provide: ENROLLMENT_ACCESS, useExisting: EnrollmentService }, EnrollmentAuthGuard,
    ], exports: [ENROLLMENT_ACCESS] };
  }
}
