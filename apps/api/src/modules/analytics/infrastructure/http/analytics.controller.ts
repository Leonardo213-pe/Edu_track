import { ArgumentsHost, Body, Catch, Controller, ExceptionFilter, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Req, UseFilters, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsInt, IsNumber, Max, Min } from 'class-validator';
import type { Response } from 'express';
import { BearerGuard, type BearerRequest } from '../../../../platform/http/bearer-guard';
import { AnalyticsService } from '../../application/analytics-service';
import { AnalyticsError } from '../../domain/risk';

const statuses: Record<AnalyticsError['code'], number> = { INVALID_INPUT: 400, FORBIDDEN: 403, NOT_FOUND: 404 };
@Catch(AnalyticsError)
export class AnalyticsErrorFilter implements ExceptionFilter {
  catch(error: AnalyticsError, host: ArgumentsHost) {
    host.switchToHttp().getResponse<Response>().status(statuses[error.code]).json({ statusCode: statuses[error.code], code: error.code });
  }
}
export class RulesDto {
  @IsInt() @Min(0) @Max(100) minProgress!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(20) minAverage!: number;
  @IsInt() @Min(1) @Max(365) maxInactiveDays!: number;
  @IsInt() @Min(1) @Max(100) maxMissed!: number;
}
const uuid = new ParseUUIDPipe();
@Controller('analytics') @UseGuards(BearerGuard) @UseFilters(AnalyticsErrorFilter)
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly analytics: AnalyticsService) {}
  @Post('courses/:courseId/heartbeat') @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60000 } })
  heartbeat(@Req() request: BearerRequest, @Param('courseId', uuid) courseId: string) { return this.analytics.heartbeat(request.principalId, courseId); }
  @Get('courses/:courseId') dashboard(@Req() request: BearerRequest, @Param('courseId', uuid) courseId: string) { return this.analytics.dashboard(request.principalId, courseId); }
  @Get('courses/:courseId/rules') rules(@Req() request: BearerRequest, @Param('courseId', uuid) courseId: string) { return this.analytics.rules(request.principalId, courseId); }
  @Put('courses/:courseId/rules') updateRules(@Req() request: BearerRequest, @Param('courseId', uuid) courseId: string, @Body() dto: RulesDto) {
    return this.analytics.updateRules(request.principalId, courseId, dto);
  }
}
