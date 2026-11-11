import { ArgumentsHost, Body, CanActivate, Catch, Controller, ExceptionFilter, ExecutionContext, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Req, UnauthorizedException, UseFilters, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { IDENTITY_DIRECTORY, type IdentityDirectory } from '../../../identity/public';
import { EnrollmentService } from '../../application/enrollment-service';
import { EnrollmentError, MAX_ROSTER } from '../../domain/enrollment';

type EnrollmentRequest = Request & { enrollmentUserId: string };
@Injectable()
export class EnrollmentAuthGuard implements CanActivate {
  constructor(@Inject(IDENTITY_DIRECTORY) private readonly identity: IdentityDirectory) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<EnrollmentRequest>();
    request.res?.setHeader('Cache-Control', 'no-store');
    const token = request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1]; if (!token) throw new UnauthorizedException();
    request.enrollmentUserId = (await this.identity.authenticate(token)).id; return true;
  }
}
@Catch(EnrollmentError)
export class EnrollmentErrorFilter implements ExceptionFilter {
  catch(error: EnrollmentError, host: ArgumentsHost) {
    const status = error.code === 'FORBIDDEN' ? 403 : 400;
    host.switchToHttp().getResponse<Response>().status(status).json({ statusCode: status, code: error.code,
      ...(error.code === 'UNKNOWN_STUDENTS' ? { unknown: error.details } : {}) });
  }
}
export class OfficialRosterDto {
  @IsArray() @ArrayMaxSize(MAX_ROSTER) @IsString({ each: true }) @MaxLength(254, { each: true }) emails!: string[];
}

@Controller('enrollments') @UseGuards(EnrollmentAuthGuard) @UseFilters(EnrollmentErrorFilter)
export class EnrollmentController {
  constructor(@Inject(EnrollmentService) private readonly enrollments: EnrollmentService) {}
  @Get('courses/:courseId') roster(@Req() request: EnrollmentRequest, @Param('courseId', ParseUUIDPipe) courseId: string) {
    return this.enrollments.roster(request.enrollmentUserId, courseId);
  }
  @Post('courses/:courseId/roster') @HttpCode(200)
  synchronize(@Req() request: EnrollmentRequest, @Param('courseId', ParseUUIDPipe) courseId: string, @Body() dto: OfficialRosterDto) {
    return this.enrollments.synchronize(request.enrollmentUserId, courseId, dto.emails);
  }
}
