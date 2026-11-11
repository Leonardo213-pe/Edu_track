import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { IDENTITY_DIRECTORY, type IdentityDirectory } from '../../modules/identity/public';

export type BearerRequest = Request & { principalId: string };
/**
 * Shared technical adapter: authenticates the Bearer JWT through the public identity contract (signature, session,
 * owner and active account). Authorization stays in each module's use cases.
 */
@Injectable()
export class BearerGuard implements CanActivate {
  constructor(@Inject(IDENTITY_DIRECTORY) private readonly identity: IdentityDirectory) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<BearerRequest>();
    request.res?.setHeader('Cache-Control', 'no-store');
    const token = request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1]; if (!token) throw new UnauthorizedException();
    request.principalId = (await this.identity.authenticate(token)).id; return true;
  }
}
