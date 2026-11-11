import { ArgumentsHost, Body, Catch, Controller, ExceptionFilter, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import type { Response } from 'express';
import { BearerGuard, type BearerRequest } from '../../../../platform/http/bearer-guard';
import { GradingService } from '../../application/grading-service';
import { GradingError } from '../../domain/grading';

const statuses: Record<GradingError['code'], number> = { INVALID_INPUT: 400, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, NOT_ENROLLED: 400, NOT_GRADABLE: 409, REASON_REQUIRED: 400 };
@Catch(GradingError)
export class GradingErrorFilter implements ExceptionFilter {
  catch(error: GradingError, host: ArgumentsHost) {
    host.switchToHttp().getResponse<Response>().status(statuses[error.code]).json({ statusCode: statuses[error.code], code: error.code });
  }
}
class AwardDto {
  @IsString() @Length(1, 40) criterionId!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) points!: number;
}
export class RubricGradeDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => AwardDto) awards!: AwardDto[];
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
  @IsOptional() @IsInt() @Min(0) version?: number;
}

const uuid = new ParseUUIDPipe();
@Controller('grading') @UseGuards(BearerGuard) @UseFilters(GradingErrorFilter)
export class GradingController {
  constructor(@Inject(GradingService) private readonly grading: GradingService) {}
  @Get('courses/:courseId/gradebook') gradebook(@Req() request: BearerRequest, @Param('courseId', uuid) courseId: string) {
    return this.grading.gradebook(request.principalId, courseId);
  }
  @Get('courses/:courseId/me') mine(@Req() request: BearerRequest, @Param('courseId', uuid) courseId: string) {
    return this.grading.myGrades(request.principalId, courseId);
  }
  @Post('assessments/:assessmentId/students/:studentId') @HttpCode(200)
  grade(@Req() request: BearerRequest, @Param('assessmentId', uuid) assessmentId: string, @Param('studentId', uuid) studentId: string, @Body() dto: RubricGradeDto) {
    return this.grading.gradeRubric(request.principalId, assessmentId, studentId, dto);
  }
}
