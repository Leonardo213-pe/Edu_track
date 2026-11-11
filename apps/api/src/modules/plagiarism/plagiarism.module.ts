import { DynamicModule, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IDENTITY_DIRECTORY, type IdentityDirectory } from '../identity/public';
import { COURSE_CATALOG, type CourseCatalog } from '../courses/public';
import { ASSESSMENT_CATALOG, type AssessmentCatalog } from '../assessments/public';
import { SUBMISSION_EVENTS, type SubmissionEvents } from '../submissions/public';
import { BearerGuard } from '../../platform/http/bearer-guard';
import { PlagiarismService } from './application/plagiarism-service';
import { PlagiarismController } from './infrastructure/http/plagiarism.controller';
import { PlagiarismConsumer } from './infrastructure/jobs/plagiarism-consumer';
import { PrismaReportRepository } from './infrastructure/persistence/prisma-report-repository';
import { SimulatedNgramPlagiarismProvider } from './infrastructure/provider/simulated-ngram-provider';

@Module({})
export class PlagiarismModule {
  static register(imports: DynamicModule[], config: { databaseUrl: string; jobIntervalMs?: number; simulatedFailFirst?: number }): DynamicModule {
    return { module: PlagiarismModule, imports, controllers: [PlagiarismController], providers: [
      { provide: PrismaReportRepository, useFactory: () => new PrismaReportRepository(config.databaseUrl) },
      { provide: PlagiarismService, inject: [PrismaReportRepository, SUBMISSION_EVENTS, ASSESSMENT_CATALOG, COURSE_CATALOG, IDENTITY_DIRECTORY],
        useFactory: (repo: PrismaReportRepository, submissions: SubmissionEvents, assessments: AssessmentCatalog, courses: CourseCatalog, identity: IdentityDirectory) =>
          new PlagiarismService(repo, { corpusFor: fileId => submissions.corpusFor(fileId) }, new SimulatedNgramPlagiarismProvider(config.simulatedFailFirst),
            { assessment: async id => { const item = await assessments.examDefinition(id); return item ? { id: item.id, courseId: item.courseId } : null; },
              course: async id => { const course = await courses.describe(id); return course ? { teacherId: course.teacherId } : null; } },
            { role: async id => (await identity.findPrincipal(id))?.role ?? null,
              names: async ids => new Map((await identity.findUsers(ids)).map(user => [user.id, user.displayName])) },
            { id: randomUUID, now: () => new Date().toISOString() }) },
      { provide: PlagiarismConsumer, inject: [SUBMISSION_EVENTS, PlagiarismService],
        useFactory: (events: SubmissionEvents, plagiarism: PlagiarismService) => new PlagiarismConsumer(events, plagiarism, config.jobIntervalMs) },
      BearerGuard,
    ] };
  }
}
