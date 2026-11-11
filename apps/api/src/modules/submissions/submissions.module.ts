import { DynamicModule, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { IDENTITY_DIRECTORY, type IdentityDirectory } from '../identity/public';
import { COURSE_CATALOG, type CourseCatalog } from '../courses/public';
import { ENROLLMENT_ACCESS, type EnrollmentAccess } from '../enrollments/public';
import { ASSESSMENT_CATALOG, type AssessmentCatalog } from '../assessments/public';
import { GRADE_RECORDER, type GradeRecorder } from '../grading/public';
import { NOTIFICATION_SENDER, type NotificationSender } from '../collaboration/public';
import { BearerGuard } from '../../platform/http/bearer-guard';
import { SubmissionService } from './application/submission-service';
import { SubmissionController, SubmissionUploadAuthorization } from './infrastructure/http/submission.controller';
import { PrismaSubmissionRepository } from './infrastructure/persistence/prisma-submission-repository';
import { LocalSubmissionStorage } from './infrastructure/storage/local-submission-storage';
import { DocumentTextExtractor } from './infrastructure/text/document-text-extractor';
import { SUBMISSION_EVENTS } from './public';

@Module({})
export class SubmissionsModule {
  static register(imports: DynamicModule[], config: { databaseUrl: string; storageRoot?: string }): DynamicModule {
    return { module: SubmissionsModule, imports, controllers: [SubmissionController], providers: [
      { provide: PrismaSubmissionRepository, useFactory: () => new PrismaSubmissionRepository(config.databaseUrl) },
      { provide: SubmissionService, inject: [PrismaSubmissionRepository, IDENTITY_DIRECTORY, COURSE_CATALOG, ENROLLMENT_ACCESS, ASSESSMENT_CATALOG, GRADE_RECORDER, NOTIFICATION_SENDER],
        useFactory: (repo: PrismaSubmissionRepository, identity: IdentityDirectory, courses: CourseCatalog, enrollment: EnrollmentAccess, assessments: AssessmentCatalog,
          grades: GradeRecorder, notifications: NotificationSender) => new SubmissionService(repo,
          new LocalSubmissionStorage(config.storageRoot ?? path.resolve('storage/submissions')), new DocumentTextExtractor(),
          { find: async id => { const principal = await identity.findPrincipal(id); return principal ? { id: principal.id, role: principal.role } : null; },
            names: async ids => new Map((await identity.findUsers(ids)).map(user => [user.id, user.displayName])) },
          { assignment: async id => { const item = await assessments.examDefinition(id); return item ? { id: item.id, courseId: item.courseId, title: item.title, type: item.type, status: item.status, dueAt: item.dueAt } : null; },
            course: async id => { const course = await courses.describe(id); return course ? { id: course.id, teacherId: course.teacherId, status: course.status, name: course.name } : null; },
            enrolled: (studentId, courseId) => enrollment.isEnrolled(studentId, courseId), studentsOf: courseId => enrollment.studentsOf(courseId),
            scoreOf: (assessmentId, studentId) => grades.scoreOf(assessmentId, studentId) },
          { received: (studentId, assignment, version) => notifications.notify([{ userId: studentId, type: 'SUBMISSION', title: `Entrega recibida: ${assignment.title}`.slice(0, 200),
            body: `Tu archivo (versión ${version}) se guardó correctamente. Puedes reemplazarlo hasta el ${new Date(assignment.dueAt).toLocaleString('es-PE', { timeZone: 'America/Lima' })}.`,
            link: { courseId: assignment.courseId, assessmentId: assignment.id } }]) },
          { id: randomUUID }) },
      { provide: SUBMISSION_EVENTS, useExisting: PrismaSubmissionRepository }, SubmissionUploadAuthorization, BearerGuard,
    ], exports: [SUBMISSION_EVENTS] };
  }
}
