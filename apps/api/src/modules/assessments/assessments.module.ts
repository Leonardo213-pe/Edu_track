import { DynamicModule, Module } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import { IDENTITY_DIRECTORY, type IdentityDirectory } from '../identity/public';
import { COURSE_CATALOG, type CourseCatalog } from '../courses/public';
import { ENROLLMENT_ACCESS, type EnrollmentAccess } from '../enrollments/public';
import { BearerGuard } from '../../platform/http/bearer-guard';
import { AssessmentService } from './application/assessment-service';
import { AssessmentController } from './infrastructure/http/assessment.controller';
import { PrismaAssessmentRepository } from './infrastructure/persistence/prisma-assessment-repository';
import { ASSESSMENT_CATALOG } from './public';

@Module({})
export class AssessmentsModule {
  static register(identityModule: DynamicModule, enrollmentsModule: DynamicModule, coursesModule: DynamicModule, config: { databaseUrl: string }): DynamicModule {
    return { module: AssessmentsModule, imports: [identityModule, enrollmentsModule, coursesModule], controllers: [AssessmentController], providers: [
      { provide: PrismaAssessmentRepository, useFactory: () => new PrismaAssessmentRepository(config.databaseUrl) },
      { provide: AssessmentService, inject: [PrismaAssessmentRepository, COURSE_CATALOG, IDENTITY_DIRECTORY, ENROLLMENT_ACCESS],
        useFactory: (repo: PrismaAssessmentRepository, courses: CourseCatalog, identity: IdentityDirectory, enrollment: EnrollmentAccess) =>
          new AssessmentService(repo, { describe: id => courses.describe(id) }, { find: id => identity.findPrincipal(id) },
            { has: (studentId, courseId) => enrollment.isEnrolled(studentId, courseId) },
            // Cryptographic randomness for draws (uniform float in [0,1) from a 48-bit integer).
            { id: randomUUID, now: () => new Date().toISOString(), random: () => randomInt(0, 2 ** 48 - 1) / 2 ** 48 }) },
      { provide: ASSESSMENT_CATALOG, useExisting: AssessmentService }, BearerGuard,
    ], exports: [ASSESSMENT_CATALOG] };
  }
}
