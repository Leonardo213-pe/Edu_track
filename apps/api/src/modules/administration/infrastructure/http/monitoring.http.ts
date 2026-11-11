import { ArgumentsHost, Catch, Controller, ExceptionFilter, Get, Inject, Injectable, NestMiddleware, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { NextFunction, Request, Response } from 'express';
import { BearerGuard, type BearerRequest } from '../../../../platform/http/bearer-guard';
import { MonitoringError, MonitoringService } from '../../application/monitoring-service';

/** Measures every API request by method and route template (never the concrete path, IDs or query strings). */
@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(@Inject(MonitoringService) private readonly monitoring: MonitoringService) {}
  use(request: Request, response: Response, next: NextFunction): void {
    const started = performance.now();
    response.once('finish', () => {
      const template = (request.route as { path?: string } | undefined)?.path;
      this.monitoring.record({ method: request.method, route: template ? `${request.baseUrl ?? ''}${template}` : 'UNMATCHED', status: response.statusCode,
        durationMs: performance.now() - started });
    });
    next();
  }
}
@Catch(MonitoringError)
export class MonitoringErrorFilter implements ExceptionFilter {
  catch(error: MonitoringError, host: ArgumentsHost) {
    const status = error.code === 'FORBIDDEN' ? 403 : 400;
    host.switchToHttp().getResponse<Response>().status(status).json({ statusCode: status, code: error.code });
  }
}
export class DashboardQuery { @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1440) minutes?: number; }
@Controller('administration') @UseGuards(BearerGuard) @UseFilters(MonitoringErrorFilter)
export class MonitoringController {
  constructor(@Inject(MonitoringService) private readonly monitoring: MonitoringService) {}
  @Get('monitoring') dashboard(@Req() request: BearerRequest, @Query() query: DashboardQuery) { return this.monitoring.dashboard(request.principalId, query.minutes ?? 15); }
}
