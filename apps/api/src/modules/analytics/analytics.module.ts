import { DynamicModule, Module } from '@nestjs/common';
import { IDENTITY_DIRECTORY, type IdentityDirectory } from '../identity/public';
import { COURSE_CATALOG, type CourseCatalog } from '../courses/public';
import { ENROLLMENT_ACCESS, type EnrollmentAccess } from '../enrollments/public';
import { ASSESSMENT_CATALOG, type AssessmentCatalog } from '../assessments/public';
import { GRADE_READER, type GradeReader } from '../grading/public';
import { BearerGuard } from '../../platform/http/bearer-guard';
import { AnalyticsService } from './application/analytics-service';
import { AnalyticsController } from './infrastructure/http/analytics.controller';
import { PrismaAnalyticsRepository } from './infrastructure/persistence/prisma-analytics-repository';

@Module({})
export class AnalyticsModule {
  static register(imports: DynamicModule[], config: { databaseUrl: string }): DynamicModule {
    return { module: AnalyticsModule, imports, controllers: [AnalyticsController], providers: [
      { provide: PrismaAnalyticsRepository, useFactory: () => new PrismaAnalyticsRepository(config.databaseUrl) },
      { provide: AnalyticsService, inject: [PrismaAnalyticsRepository, IDENTITY_DIRECTORY, COURSE_CATALOG, ENROLLMENT_ACCESS, GRADE_READER, ASSESSMENT_CATALOG],
        useFactory: (repo: PrismaAnalyticsRepository, identity: IdentityDirectory, courses: CourseCatalog, enrollment: EnrollmentAccess, grades: GradeReader, assessments: AssessmentCatalog) =>
          new AnalyticsService(repo,
            { role: async id => (await identity.findPrincipal(id))?.role ?? null, names: async ids => new Map((await identity.findUsers(ids)).map(user => [user.id, user.displayName])) },
            { describe: id => courses.describe(id), progressOf: id => courses.progressOf(id) },
            { has: (studentId, courseId) => enrollment.isEnrolled(studentId, courseId), studentsOf: courseId => enrollment.studentsOf(courseId) },
            { standing: courseId => grades.standing(courseId) }, { gradable: courseId => assessments.gradable(courseId) }, { now: () => new Date() }) },
      BearerGuard,
    ] };
  }
}
