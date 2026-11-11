import 'reflect-metadata';
import { Controller, DynamicModule, Get, Inject, Module, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { NestFactory, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import helmet from 'helmet';
import { IdentityModule, IDENTITY_READINESS } from './modules/identity/identity.module';
import { IdentityErrorFilter } from './modules/identity/infrastructure/http/identity-error.filter';
import type { AppConfig } from './config';
import { CoursesModule } from './modules/courses/courses.module';
import { FixtureEnrollmentAccess, NoSynchronizedEnrollments } from './modules/enrollments/infrastructure/fixture-enrollment-access';

@Controller('health')
class HealthController {
  constructor(@Inject(IDENTITY_READINESS) private readonly readiness: { check(): Promise<void> }) {}
  @Get('live') live() { return { status: 'ok' }; }
  @Get('ready') async ready() {
    try { await this.readiness.check(); return { status: 'ready' }; }
    catch { throw new ServiceUnavailableException('Not ready'); }
  }
}
@Module({})
class AppModule {
  static register(config: AppConfig): DynamicModule {
    const identity = IdentityModule.register(config);
    if (config.academic?.enrollmentFixtureFile && !config.academic.allowTestEnrollments) throw new Error('Enrollment fixtures require explicit ALLOW_TEST_ENROLLMENTS=true');
    const enrollment = config.academic?.enrollmentFixtureFile ? new FixtureEnrollmentAccess(config.academic.enrollmentFixtureFile) : new NoSynchronizedEnrollments();
    return { module: AppModule, imports: [identity, CoursesModule.register(identity, { databaseUrl: config.databaseUrl, storageRoot: config.academic?.storageRoot }, enrollment),
      ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }])],
      controllers: [HealthController], providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }] };
  }
}
export async function createApplication(config: AppConfig) {
  const app = await NestFactory.create(AppModule.register(config), { logger: ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.enableCors({ origin: config.webOrigin, methods: ['GET', 'POST', 'PATCH'], allowedHeaders: ['Content-Type', 'Authorization'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new IdentityErrorFilter());
  app.enableShutdownHooks();
  return app;
}
