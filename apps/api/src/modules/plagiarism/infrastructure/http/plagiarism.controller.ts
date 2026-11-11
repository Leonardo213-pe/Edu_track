import { ArgumentsHost, Catch, Controller, ExceptionFilter, Get, Inject, Param, ParseUUIDPipe, Req, UseFilters, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { BearerGuard, type BearerRequest } from '../../../../platform/http/bearer-guard';
import { PlagiarismError, PlagiarismService } from '../../application/plagiarism-service';

@Catch(PlagiarismError)
export class PlagiarismErrorFilter implements ExceptionFilter {
  catch(error: PlagiarismError, host: ArgumentsHost) {
    const status = error.code === 'FORBIDDEN' ? 403 : 404;
    host.switchToHttp().getResponse<Response>().status(status).json({ statusCode: status, code: error.code });
  }
}
@Controller('plagiarism') @UseGuards(BearerGuard) @UseFilters(PlagiarismErrorFilter)
export class PlagiarismController {
  constructor(@Inject(PlagiarismService) private readonly plagiarism: PlagiarismService) {}
  @Get('assessments/:assessmentId') reports(@Req() request: BearerRequest, @Param('assessmentId', ParseUUIDPipe) assessmentId: string) {
    return this.plagiarism.forAssessment(request.principalId, assessmentId);
  }
}
