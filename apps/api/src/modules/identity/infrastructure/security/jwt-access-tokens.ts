import { JwtService } from '@nestjs/jwt';
import type { AccessTokens } from '../../application/ports';
export class JwtAccessTokens implements AccessTokens {
  private readonly jwt: JwtService;
  constructor(secret: string) {
    this.jwt = new JwtService({ secret, signOptions: { algorithm: 'HS256', expiresIn: 900,
      issuer: 'edutrack-api', audience: 'edutrack-web' }, verifyOptions: {
      algorithms: ['HS256'], issuer: 'edutrack-api', audience: 'edutrack-web' } });
  }
  issue(userId: string, sessionId: string): Promise<string> { return this.jwt.signAsync({}, { subject: userId, jwtid: sessionId }); }
  async verify(token: string): Promise<{ userId: string; sessionId: string }> {
    const payload = await this.jwt.verifyAsync<{ sub?: string; jti?: string }>(token);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!payload.sub || !uuid.test(payload.sub) || !payload.jti || !uuid.test(payload.jti)) throw new Error('Invalid token claims');
    return { userId: payload.sub, sessionId: payload.jti };
  }
}
