import { DynamicModule, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { IDENTITY_DIRECTORY, type IdentityDirectory } from '../identity/public';
import { ENROLLMENT_ACCESS, REGISTRY_SECTIONS, type EnrollmentAccess, type RegistrySections } from '../enrollments/public';
import { CourseService } from './application/course-service';
import { PrismaCourseRepository } from './infrastructure/persistence/prisma-course-repository';
import { CourseController } from './infrastructure/http/course.controller';
import { CourseAuthGuard, UploadAuthorization } from './infrastructure/http/course-http';
import { LocalCourseStorage } from './infrastructure/storage/local-course-storage';
import { COURSE_CATALOG } from './public';

@Module({})
export class CoursesModule {
  static register(identityModule: DynamicModule, enrollmentsModule: DynamicModule, config: { databaseUrl: string; storageRoot?: string }): DynamicModule {
    return { module: CoursesModule, imports: [identityModule, enrollmentsModule], controllers: [CourseController], providers: [
      { provide: PrismaCourseRepository, useFactory: () => new PrismaCourseRepository(config.databaseUrl) },
      { provide: CourseService, inject: [PrismaCourseRepository, IDENTITY_DIRECTORY, ENROLLMENT_ACCESS, REGISTRY_SECTIONS],
        useFactory: (repo: PrismaCourseRepository, identity: IdentityDirectory, enrollment: EnrollmentAccess, sections: RegistrySections) => new CourseService(repo, {
          find: id => identity.findPrincipal(id),
          teachers: () => identity.listInstructors(),
          names: async ids => new Map((await identity.findUsers(ids)).map(user => [user.id, user.displayName])),
        }, { has: (userId, courseId) => enrollment.isEnrolled(userId, courseId), courses: userId => enrollment.coursesOf(userId),
          link: (courseId, code, period) => sections.link(courseId, code, period) },
        new LocalCourseStorage(config.storageRoot ?? path.resolve('storage/courses')), { id: randomUUID, now: () => new Date().toISOString() }) },
      { provide: COURSE_CATALOG, useExisting: CourseService }, CourseAuthGuard, UploadAuthorization,
    ], exports: [COURSE_CATALOG] };
  }
}
