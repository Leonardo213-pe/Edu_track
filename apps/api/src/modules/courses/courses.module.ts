import { DynamicModule, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { IDENTITY_DIRECTORY, type IdentityDirectory } from '../identity/public';
import type { EnrollmentAccess } from '../enrollments/public';
import { CourseService } from './application/course-service';
import { PrismaCourseRepository } from './infrastructure/persistence/prisma-course-repository';
import { CourseAuthGuard, CourseController } from './infrastructure/http/course.controller';
import { LocalCourseStorage } from './infrastructure/storage/local-course-storage';
import { COURSE_CATALOG } from './public';
@Module({})
export class CoursesModule {
  static register(identityModule: DynamicModule, config: { databaseUrl: string; storageRoot?: string }, enrollment: EnrollmentAccess): DynamicModule {
    return { module: CoursesModule, imports: [identityModule], controllers: [CourseController], providers: [
      { provide: PrismaCourseRepository, useFactory: () => new PrismaCourseRepository(config.databaseUrl) },
      { provide: CourseService, inject: [PrismaCourseRepository, IDENTITY_DIRECTORY], useFactory: (repo: PrismaCourseRepository, identity: IdentityDirectory) =>
        new CourseService(repo, { find: id => identity.findPrincipal(id), teachers: () => identity.listInstructors() }, { has: (userId, courseId) => enrollment.isEnrolled(userId, courseId) },
          new LocalCourseStorage(config.storageRoot ?? path.resolve('storage/courses')), { id: randomUUID, now: () => new Date().toISOString() }) },
      { provide: COURSE_CATALOG, useExisting: CourseService }, CourseAuthGuard,
    ], exports: [COURSE_CATALOG] };
  }
}
