import { DynamicModule, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IDENTITY_DIRECTORY, type IdentityDirectory } from '../identity/public';
import { COURSE_CATALOG, type CourseCatalog } from '../courses/public';
import { ENROLLMENT_ACCESS, type EnrollmentAccess } from '../enrollments/public';
import { ASSESSMENT_CATALOG, type AssessmentCatalog } from '../assessments/public';
import { BearerGuard } from '../../platform/http/bearer-guard';
import { CollaborationService } from './application/collaboration-service';
import { CollaborationController } from './infrastructure/http/collaboration.controller';
import { DueDateReminders } from './infrastructure/jobs/due-date-reminders';
import { PrismaCollaborationRepository } from './infrastructure/persistence/prisma-collaboration-repository';
import { NOTIFICATION_SENDER } from './public';

@Module({})
export class CollaborationModule {
  static register(imports: DynamicModule[], config: { databaseUrl: string; reminderIntervalMs?: number }): DynamicModule {
    return { module: CollaborationModule, imports, controllers: [CollaborationController], providers: [
      { provide: PrismaCollaborationRepository, useFactory: () => new PrismaCollaborationRepository(config.databaseUrl) },
      { provide: CollaborationService, inject: [PrismaCollaborationRepository, IDENTITY_DIRECTORY, COURSE_CATALOG, ENROLLMENT_ACCESS, ASSESSMENT_CATALOG],
        useFactory: (repo: PrismaCollaborationRepository, identity: IdentityDirectory, courses: CourseCatalog, enrollment: EnrollmentAccess, assessments: AssessmentCatalog) =>
          new CollaborationService(repo,
            { find: id => identity.findPrincipal(id), names: async ids => new Map((await identity.findUsers(ids)).map(user => [user.id, user.displayName])) },
            { describe: id => courses.describe(id), units: id => courses.units(id) },
            { has: (studentId, courseId) => enrollment.isEnrolled(studentId, courseId), studentsOf: courseId => enrollment.studentsOf(courseId) },
            { dueBetween: (from, to) => assessments.dueBetween(from, to) },
            { id: randomUUID, now: () => new Date().toISOString() }) },
      { provide: DueDateReminders, inject: [CollaborationService], useFactory: (service: CollaborationService) => new DueDateReminders(service, config.reminderIntervalMs) },
      { provide: NOTIFICATION_SENDER, useExisting: CollaborationService }, BearerGuard,
    ], exports: [NOTIFICATION_SENDER] };
  }
}
