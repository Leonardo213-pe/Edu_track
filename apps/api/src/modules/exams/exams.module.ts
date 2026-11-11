import { DynamicModule, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IDENTITY_DIRECTORY, type IdentityDirectory } from '../identity/public';
import { COURSE_CATALOG, type CourseCatalog } from '../courses/public';
import { ENROLLMENT_ACCESS, type EnrollmentAccess } from '../enrollments/public';
import { ASSESSMENT_CATALOG, type AssessmentCatalog } from '../assessments/public';
import { GRADE_RECORDER, type GradeRecorder } from '../grading/public';
import { BearerGuard } from '../../platform/http/bearer-guard';
import { ExamService } from './application/exam-service';
import { ExamController } from './infrastructure/http/exam.controller';
import { ExamJobs } from './infrastructure/jobs/exam-jobs';
import { PrismaExamRepository } from './infrastructure/persistence/prisma-exam-repository';
import { EXAM_MONITOR } from './public';

@Module({})
export class ExamsModule {
  static register(imports: DynamicModule[], config: { databaseUrl: string; jobIntervalMs?: number }): DynamicModule {
    return { module: ExamsModule, imports, controllers: [ExamController], providers: [
      { provide: PrismaExamRepository, useFactory: () => new PrismaExamRepository(config.databaseUrl) },
      { provide: ExamService, inject: [PrismaExamRepository, ASSESSMENT_CATALOG, COURSE_CATALOG, ENROLLMENT_ACCESS, IDENTITY_DIRECTORY, GRADE_RECORDER],
        useFactory: (repo: PrismaExamRepository, assessments: AssessmentCatalog, courses: CourseCatalog, enrollment: EnrollmentAccess, identity: IdentityDirectory, grades: GradeRecorder) =>
          new ExamService(repo,
            { definition: id => assessments.examDefinition(id), draw: id => assessments.drawForAttempt(id),
              answerKey: async id => (await assessments.answerKey(id)).map(item => ({ ...item, correctOptionIds: [...item.correctOptionIds] })) },
            { describe: id => courses.describe(id) }, { has: (studentId, courseId) => enrollment.isEnrolled(studentId, courseId) },
            { role: async id => (await identity.findPrincipal(id))?.role ?? null,
              names: async ids => new Map((await identity.findUsers(ids)).map(user => [user.id, user.displayName])) },
            { recordAutomatic: input => grades.recordAutomatic(input), scoreOf: (assessmentId, studentId) => grades.scoreOf(assessmentId, studentId) },
            { id: randomUUID }) },
      { provide: ExamJobs, inject: [ExamService, PrismaExamRepository], useFactory: (exams: ExamService, repo: PrismaExamRepository) => new ExamJobs(exams, repo, config.jobIntervalMs) },
      { provide: EXAM_MONITOR, useExisting: PrismaExamRepository }, BearerGuard,
    ], exports: [EXAM_MONITOR] };
  }
}
