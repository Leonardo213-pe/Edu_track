import { createHash, randomBytes } from 'node:crypto';
import type { SecurityTokens } from '../../application/ports';
export class RandomSecurityTokens implements SecurityTokens {
  random(): string { return randomBytes(32).toString('hex'); }
  digest(token: string): string { return createHash('sha256').update(token).digest('hex'); }
}
