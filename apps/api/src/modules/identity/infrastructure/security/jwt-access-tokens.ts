import { JwtService } from '@nestjs/jwt';
import type { AccessTokens } from '../../application/ports';
export class JwtAccessTokens implements AccessTokens {
  private readonly jwt: JwtService;
  constructor(secret: string) {
    this.jwt = new JwtService({ secret, signOptions: { algorithm: 'HS256', expiresIn: 900,
      issuer: 'edutrack-api', audience: 'edutrack-web' }, verifyOptions: {
      algorithms: ['HS256'], issuer: 'edutrack-api', audience: 'edutrack-web' } });
  }
  issue(userId: string): Promise<string> { return this.jwt.signAsync({}, { subject: userId }); }
  async verify(token: string): Promise<string> {
    const payload = await this.jwt.verifyAsync<{ sub?: string }>(token);
    if (!payload.sub || !/^[0-9a-f-]{36}$/i.test(payload.sub)) throw new Error('Invalid token subject');
    return payload.sub;
  }
}
