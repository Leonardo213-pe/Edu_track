import { ArgumentsHost, Body, Catch, Controller, Delete, ExceptionFilter, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import type { Response } from 'express';
import { BearerGuard, type BearerRequest } from '../../../../platform/http/bearer-guard';
import { AssessmentService } from '../../application/assessment-service';
import { AssessmentError } from '../../domain/question';

const statuses: Record<AssessmentError['code'], number> = { INVALID_INPUT: 400, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INVALID_STATE: 409,
  WEIGHT_EXCEEDED: 400, INSUFFICIENT_QUESTIONS: 400, COURSE_NOT_PUBLISHED: 409 };
@Catch(AssessmentError)
export class AssessmentErrorFilter implements ExceptionFilter {
  catch(error: AssessmentError, host: ArgumentsHost) {
    host.switchToHttp().getResponse<Response>().status(statuses[error.code]).json({ statusCode: statuses[error.code], code: error.code });
  }
}

class OptionDto {
  @IsOptional() @IsString() @Length(1, 40) id?: string;
  @IsString() @Length(1, 1000) text!: string;
  @IsBoolean() correct!: boolean;
}
export class QuestionDto {
  @IsIn(['SINGLE', 'MULTIPLE', 'TRUE_FALSE']) type!: 'SINGLE' | 'MULTIPLE' | 'TRUE_FALSE';
  @IsString() @Length(1, 5000) statement!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100) points!: number;
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => OptionDto) options!: OptionDto[];
  @IsOptional() @IsBoolean() active?: boolean;
}
export class EditQuestionDto extends QuestionDto { @IsInt() @Min(0) version!: number; }
export class BankDto { @IsString() @Length(1, 160) name!: string; }
class CriterionDto {
  @IsOptional() @IsString() @Length(1, 40) id?: string;
  @IsString() @Length(1, 500) description!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100) maxPoints!: number;
}
export class AssessmentDto {
  @IsString() @Length(1, 160) title!: string;
  @IsString() @MaxLength(5000) instructions!: string;
  @IsIn(['QUIZ', 'RUBRIC']) type!: 'QUIZ' | 'RUBRIC';
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100) weight!: number;
  @IsISO8601() dueAt!: string;
  @IsOptional() @IsInt() @Min(1) @Max(1440) durationMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(200) questionCount?: number;
  @IsOptional() @IsUUID() bankId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => CriterionDto) criteria?: CriterionDto[];
}
export class EditAssessmentDto extends AssessmentDto { @IsInt() @Min(0) revision!: number; }
export class RevisionDto { @Type(() => Number) @IsInt() @Min(0) revision!: number; }

const uuid = new ParseUUIDPipe();
@Controller('assessments') @UseGuards(BearerGuard) @UseFilters(AssessmentErrorFilter)
export class AssessmentController {
  constructor(@Inject(AssessmentService) private readonly assessments: AssessmentService) {}
  @Get('courses/:courseId/banks') banks(@Req() request: BearerRequest, @Param('courseId', uuid) courseId: string) {
    return this.assessments.banks(request.principalId, courseId);
  }
  @Post('courses/:courseId/banks') createBank(@Req() request: BearerRequest, @Param('courseId', uuid) courseId: string, @Body() dto: BankDto) {
    return this.assessments.createBank(request.principalId, courseId, dto.name);
  }
  @Post('banks/:bankId/questions') addQuestion(@Req() request: BearerRequest, @Param('bankId', uuid) bankId: string, @Body() dto: QuestionDto) {
    return this.assessments.addQuestion(request.principalId, bankId, dto);
  }
  @Patch('questions/:questionId') editQuestion(@Req() request: BearerRequest, @Param('questionId', uuid) questionId: string, @Body() dto: EditQuestionDto) {
    const { version, ...input } = dto; return this.assessments.editQuestion(request.principalId, questionId, version, input);
  }
  @Get('courses/:courseId') list(@Req() request: BearerRequest, @Param('courseId', uuid) courseId: string) {
    return this.assessments.list(request.principalId, courseId);
  }
  @Post('courses/:courseId') create(@Req() request: BearerRequest, @Param('courseId', uuid) courseId: string, @Body() dto: AssessmentDto) {
    return this.assessments.create(request.principalId, courseId, dto);
  }
  @Patch(':id') edit(@Req() request: BearerRequest, @Param('id', uuid) id: string, @Body() dto: EditAssessmentDto) {
    const { revision, ...input } = dto; return this.assessments.edit(request.principalId, id, revision, input);
  }
  @Post(':id/publish') @HttpCode(200) publish(@Req() request: BearerRequest, @Param('id', uuid) id: string, @Body() dto: RevisionDto) {
    return this.assessments.publish(request.principalId, id, dto.revision);
  }
  @Post(':id/close') @HttpCode(200) close(@Req() request: BearerRequest, @Param('id', uuid) id: string, @Body() dto: RevisionDto) {
    return this.assessments.close(request.principalId, id, dto.revision);
  }
  @Delete(':id') @HttpCode(204) remove(@Req() request: BearerRequest, @Param('id', uuid) id: string, @Query() dto: RevisionDto) {
    return this.assessments.remove(request.principalId, id, dto.revision);
  }
  @Get(':id/preview') preview(@Req() request: BearerRequest, @Param('id', uuid) id: string) {
    return this.assessments.preview(request.principalId, id);
  }
}
