import { ArgumentsHost, BadRequestException, CallHandler, CanActivate, Catch, ExceptionFilter, ExecutionContext, Inject, Injectable, NestInterceptor, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { IDENTITY_DIRECTORY, type IdentityDirectory } from '../../../identity/public';
import { CourseService } from '../../application/course-service';
import { CourseError } from '../../domain/course';

export type CourseRequest = Request & { academicUserId: string };

/** Authenticates through the public identity contract (session, owner and active account are checked there). */
@Injectable()
export class CourseAuthGuard implements CanActivate {
  constructor(@Inject(IDENTITY_DIRECTORY) private readonly identity: IdentityDirectory) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CourseRequest>();
    request.res?.setHeader('Cache-Control', 'no-store');
    const token = request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1]; if (!token) throw new UnauthorizedException();
    request.academicUserId = (await this.identity.authenticate(token)).id; return true;
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Runs before the multipart parser: only an authorized editor of a draft can make the server receive file bytes. */
@Injectable()
export class UploadAuthorization implements NestInterceptor {
  constructor(@Inject(CourseService) private readonly courses: CourseService) {}
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<CourseRequest>();
    const { id, sessionId } = request.params as { id?: string; sessionId?: string };
    if (!id || !sessionId || !uuid.test(id) || !uuid.test(sessionId)) throw new BadRequestException();
    await this.courses.authorizeUpload(request.academicUserId, id, sessionId);
    return next.handle();
  }
}

const statuses = { INVALID_INPUT: 400, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INVALID_STATE: 409, INCOMPLETE_COURSE: 400, FILE_REJECTED: 400 };
@Catch(CourseError)
export class CourseErrorFilter implements ExceptionFilter {
  catch(error: CourseError, host: ArgumentsHost) {
    const status = statuses[error.code];
    host.switchToHttp().getResponse<Response>().status(status).json({ statusCode: status, code: error.code });
  }
}
