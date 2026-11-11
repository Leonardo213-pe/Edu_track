import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { IdentityError } from '../../domain/errors';
const statuses = { INVALID_INPUT: 400, INVALID_CREDENTIALS: 401, FORBIDDEN: 403, EMAIL_EXISTS: 409 };
@Catch(IdentityError)
export class IdentityErrorFilter implements ExceptionFilter {
  catch(error: IdentityError, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().status(statuses[error.code]).json({
      statusCode: statuses[error.code], code: error.code,
    });
  }
}
