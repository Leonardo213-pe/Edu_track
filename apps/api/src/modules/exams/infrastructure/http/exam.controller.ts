import { ArgumentsHost, Body, Catch, Controller, ExceptionFilter, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Req, UseFilters, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsInt, IsString, Length, Max, Min } from 'class-validator';
import type { Response } from 'express';
import { BearerGuard, type BearerRequest } from '../../../../platform/http/bearer-guard';
import { ExamService } from '../../application/exam-service';
import { ExamError } from '../../domain/attempt';

const statuses: Record<ExamError['code'], number> = { INVALID_INPUT: 400, FORBIDDEN: 403, NOT_FOUND: 404, NOT_AVAILABLE: 409, ATTEMPT_CLOSED: 409 };
@Catch(ExamError)
export class ExamErrorFilter implements ExceptionFilter {
  catch(error: ExamError, host: ArgumentsHost) {
    host.switchToHttp().getResponse<Response>().status(statuses[error.code]).json({ statusCode: statuses[error.code], code: error.code });
  }
}
export class AnswerDto {
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @Length(1, 40, { each: true }) optionIds!: string[];
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) version!: number;
}

const uuid = new ParseUUIDPipe();
@Controller('exams') @UseGuards(BearerGuard) @UseFilters(ExamErrorFilter)
export class ExamController {
  constructor(@Inject(ExamService) private readonly exams: ExamService) {}
  @Get('assessments/:assessmentId/attempt') status(@Req() request: BearerRequest, @Param('assessmentId', uuid) assessmentId: string) {
    return this.exams.status(request.principalId, assessmentId);
  }
  @Post('assessments/:assessmentId/attempt') @HttpCode(200) start(@Req() request: BearerRequest, @Param('assessmentId', uuid) assessmentId: string) {
    return this.exams.start(request.principalId, assessmentId);
  }
  @Get('assessments/:assessmentId/attempts') attempts(@Req() request: BearerRequest, @Param('assessmentId', uuid) assessmentId: string) {
    return this.exams.attempts(request.principalId, assessmentId);
  }
  @Get('attempts/:attemptId') view(@Req() request: BearerRequest, @Param('attemptId', uuid) attemptId: string) {
    return this.exams.view(request.principalId, attemptId);
  }
  /** Autosave (≤15 s and on change). Higher per-client limit than the global one; the ACK is sent after the commit. */
  @Put('attempts/:attemptId/answers/:questionId') @Throttle({ default: { limit: 300, ttl: 60000 } })
  save(@Req() request: BearerRequest, @Param('attemptId', uuid) attemptId: string, @Param('questionId', uuid) questionId: string, @Body() dto: AnswerDto) {
    return this.exams.saveAnswer(request.principalId, attemptId, questionId, dto.optionIds, dto.version);
  }
  @Post('attempts/:attemptId/finalize') @HttpCode(200) finalize(@Req() request: BearerRequest, @Param('attemptId', uuid) attemptId: string) {
    return this.exams.finalize(request.principalId, attemptId);
  }
}
