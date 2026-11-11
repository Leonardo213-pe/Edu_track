import { ArgumentsHost, BadRequestException, CallHandler, Catch, Controller, ExceptionFilter, ExecutionContext, Get, Inject, Injectable, NestInterceptor, Param, ParseUUIDPipe, Post, Req, Res, UploadedFile, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { BearerGuard, type BearerRequest } from '../../../../platform/http/bearer-guard';
import { SubmissionService } from '../../application/submission-service';
import { MAX_SUBMISSION_BYTES, SubmissionError } from '../../domain/submission';

const statuses: Record<SubmissionError['code'], number> = { INVALID_INPUT: 400, FILE_REJECTED: 400, NOT_ENROLLED: 403, FORBIDDEN: 403, NOT_FOUND: 404,
  NOT_AN_ASSIGNMENT: 409, NOT_AVAILABLE: 409, DEADLINE_PASSED: 409 };
@Catch(SubmissionError)
export class SubmissionErrorFilter implements ExceptionFilter {
  catch(error: SubmissionError, host: ArgumentsHost) {
    const status = statuses[error.code];
    host.switchToHttp().getResponse<Response>().status(status).json({ statusCode: status, code: error.code });
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Runs before the multipart parser: only an enrolled student of an open assignment makes the server receive bytes. */
@Injectable()
export class SubmissionUploadAuthorization implements NestInterceptor {
  constructor(@Inject(SubmissionService) private readonly submissions: SubmissionService) {}
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<BearerRequest>();
    const { assessmentId } = request.params as { assessmentId?: string };
    if (!assessmentId || !uuid.test(assessmentId)) throw new BadRequestException();
    await this.submissions.authorizeUpload(request.principalId, assessmentId);
    return next.handle();
  }
}

@Controller('submissions') @UseGuards(BearerGuard) @UseFilters(SubmissionErrorFilter)
export class SubmissionController {
  constructor(@Inject(SubmissionService) private readonly submissions: SubmissionService) {}
  @Post('assessments/:assessmentId')
  @UseInterceptors(SubmissionUploadAuthorization, FileInterceptor('file', { limits: { fileSize: MAX_SUBMISSION_BYTES, files: 1, fields: 2, fieldSize: 1024 } }))
  submit(@Req() request: BearerRequest, @Param('assessmentId', ParseUUIDPipe) assessmentId: string, @UploadedFile() file?: { buffer: Buffer; originalname: string; mimetype: string }) {
    if (!file) throw new SubmissionError('FILE_REJECTED');
    return this.submissions.submit(request.principalId, assessmentId, { bytes: file.buffer, filename: Buffer.from(file.originalname, 'latin1').toString('utf8'), mimeType: file.mimetype });
  }
  @Get('assessments/:assessmentId/me') mine(@Req() request: BearerRequest, @Param('assessmentId', ParseUUIDPipe) assessmentId: string) {
    return this.submissions.mine(request.principalId, assessmentId);
  }
  @Get('assessments/:assessmentId') list(@Req() request: BearerRequest, @Param('assessmentId', ParseUUIDPipe) assessmentId: string) {
    return this.submissions.forAssessment(request.principalId, assessmentId);
  }
  @Get('files/:fileId') async download(@Req() request: BearerRequest, @Res() response: Response, @Param('fileId', ParseUUIDPipe) fileId: string) {
    const file = await this.submissions.download(request.principalId, fileId);
    response.setHeader('Content-Type', file.mimeType); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.filename).replace(/'/g, '%27')}`);
    response.setHeader('Cache-Control', 'no-store'); response.send(Buffer.from(file.bytes));
  }
}
