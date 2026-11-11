import 'reflect-metadata';
import { Controller, DynamicModule, Get, Inject, Module, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { NestFactory, APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import helmet from 'helmet';
import { IdentityModule, IDENTITY_READINESS } from './modules/identity/identity.module';
import { EnrollmentsModule } from './modules/enrollments/enrollments.module';
import { CoursesModule } from './modules/courses/courses.module';
import { AuditModule } from './modules/audit/audit.module';
import { AssessmentsModule } from './modules/assessments/assessments.module';
import { GradingModule } from './modules/grading/grading.module';
import { ExamsModule } from './modules/exams/exams.module';
import { CollaborationModule } from './modules/collaboration/collaboration.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AdministrationModule } from './modules/administration/administration.module';
import type { AppConfig } from './config';

@Controller('health')
class HealthController {
  constructor(@Inject(IDENTITY_READINESS) private readonly readiness: { check(): Promise<void> }) {}
  @Get ('live') live() { return { status: 'ok' }; }
  @Get('ready') async ready() {
    try { await this.readiness.check(); return { status: 'ready' }; }
    catch { throw new ServiceUnavailableException('Not ready'); }
  }
}
@Module({})
class AppModule {
  static register(config: AppConfig): DynamicModule {
    const identity = IdentityModule.register(config);
    const enrollments = EnrollmentsModule.register(identity, { databaseUrl: config.databaseUrl, registry: config.registry });
    const courses = CoursesModule.register(identity, enrollments, { databaseUrl: config.databaseUrl, storageRoot: config.academic?.storageRoot });
    const assessments = AssessmentsModule.register(identity, enrollments, courses, { databaseUrl: config.databaseUrl });
    const collaboration = CollaborationModule.register([identity, enrollments, courses, assessments], { databaseUrl: config.databaseUrl, reminderIntervalMs: config.reminderIntervalMs });
    const grading = GradingModule.register(identity, enrollments, courses, assessments, collaboration, { databaseUrl: config.databaseUrl });
    return { module: AppModule, imports: [identity, enrollments, courses, assessments, collaboration, grading,
      ExamsModule.register([identity, enrollments, courses, assessments, grading], { databaseUrl: config.databaseUrl, jobIntervalMs: config.examJobIntervalMs }),
      AnalyticsModule.register([identity, enrollments, courses, assessments, grading], { databaseUrl: config.databaseUrl }),
      AuditModule.register(identity, { databaseUrl: config.databaseUrl }),
      AdministrationModule.register([identity, enrollments, collaboration], { alertIntervalMs: config.alertIntervalMs }),
      ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }])],
      controllers: [HealthController], providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }] };
  }
}
export async function createApplication(config: AppConfig) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), { logger: ['error', 'warn', 'log'] });
  // Rate limits key on req.ip: behind Nginx only the configured trusted proxies may supply X-Forwarded-For.
  if (config.trustProxy !== undefined) app.set('trust proxy', config.trustProxy);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.enableCors({ origin: config.webOrigin, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  return app;
}
