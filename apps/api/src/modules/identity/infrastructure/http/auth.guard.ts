import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { IdentityService } from '../../application/identity-service';
import type { UserProfile } from '../../public';
export type AuthenticatedRequest = Request & { user: UserProfile };
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const match = header?.match(/^Bearer (\S+)$/);
    if (!match?.[1]) throw new UnauthorizedException();
    request.user = await this.identity.authenticate(match[1]);
    return true;
  }
}
