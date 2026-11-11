import { Controller, Get, HttpCode, Inject, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import { RegistrySyncService } from '../../application/registry-sync-service';
import { EnrollmentAuthGuard, EnrollmentErrorFilter, type EnrollmentRequest } from './enrollment.controller';

/** ADMIN console of the Academic Registry synchronization (CU-12): status, history and "Sincronizar ahora". */
@Controller('enrollments/registry') @UseGuards(EnrollmentAuthGuard) @UseFilters(EnrollmentErrorFilter)
export class RegistrySyncController {
  constructor(@Inject(RegistrySyncService) private readonly sync: RegistrySyncService) {}
  @Get() overview(@Req() request: EnrollmentRequest) { return this.sync.overview(request.enrollmentUserId); }
  @Post('sync') @HttpCode(200) runNow(@Req() request: EnrollmentRequest) { return this.sync.runNow(request.enrollmentUserId); }
}
