import { DynamicModule, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IDENTITY_DIRECTORY, type IdentityDirectory } from '../identity/public';
import { COURSE_CATALOG, type CourseCatalog } from '../courses/public';
import { ENROLLMENT_ACCESS, type EnrollmentAccess } from '../enrollments/public';
import { ASSESSMENT_CATALOG, type AssessmentCatalog } from '../assessments/public';
import { NOTIFICATION_SENDER, type NotificationSender } from '../collaboration/public';
import { SYSTEM_ACTOR_ID } from '../audit/public';
import { BearerGuard } from '../../platform/http/bearer-guard';
import { GRADE_READER, GRADE_RECORDER, type GradeReader, type GradeRecorder } from './public';
import { GradingService } from './application/grading-service';
import { GradingController } from './infrastructure/http/grading.controller';
import { PrismaGradeRepository } from './infrastructure/persistence/prisma-grade-repository';

@Module({})
export class GradingModule {
  static register(identityModule: DynamicModule, enrollmentsModule: DynamicModule, coursesModule: DynamicModule, assessmentsModule: DynamicModule,
    collaborationModule: DynamicModule, config: { databaseUrl: string }): DynamicModule {
    return { module: GradingModule, imports: [identityModule, enrollmentsModule, coursesModule, assessmentsModule, collaborationModule], controllers: [GradingController], providers: [
      { provide: PrismaGradeRepository, useFactory: () => new PrismaGradeRepository(config.databaseUrl) },
      { provide: GradingService, inject: [PrismaGradeRepository, ASSESSMENT_CATALOG, COURSE_CATALOG, ENROLLMENT_ACCESS, IDENTITY_DIRECTORY, NOTIFICATION_SENDER],
        useFactory: (repo: PrismaGradeRepository, assessments: AssessmentCatalog, courses: CourseCatalog, enrollment: EnrollmentAccess, identity: IdentityDirectory,
          notifications: NotificationSender) =>
          new GradingService(repo, { gradable: courseId => assessments.gradable(courseId), findGradable: id => assessments.findGradable(id) },
            { describe: id => courses.describe(id) },
            { has: (studentId, courseId) => enrollment.isEnrolled(studentId, courseId), studentsOf: courseId => enrollment.studentsOf(courseId) },
            { role: async id => (await identity.findPrincipal(id))?.role ?? null,
              names: async ids => new Map((await identity.findUsers(ids)).map(user => [user.id, user.displayName])) },
            { id: randomUUID, now: () => new Date().toISOString() },
            // Observer-style notice to the student; best effort, the audited grade is already committed.
            { gradeRecorded: input => notifications.notify([{ userId: input.studentId, type: 'GRADE', title: `Nota registrada: ${input.title}`,
              body: `Tu nota es ${input.score.toLocaleString('es-PE')} / 20.`, link: { courseId: input.courseId, assessmentId: input.assessmentId } }]) }) },
      { provide: GRADE_RECORDER, inject: [GradingService], useFactory: (grading: GradingService): GradeRecorder => ({
        recordAutomatic: input => grading.recordAutomatic(input, SYSTEM_ACTOR_ID), scoreOf: (assessmentId, studentId) => grading.scoreOf(assessmentId, studentId) }) },
      { provide: GRADE_READER, inject: [GradingService], useFactory: (grading: GradingService): GradeReader => ({ standing: courseId => grading.standing(courseId) }) },
      BearerGuard,
    ], exports: [GRADE_RECORDER, GRADE_READER] };
  }
}
