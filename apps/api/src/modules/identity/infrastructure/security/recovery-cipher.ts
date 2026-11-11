import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { ResetMessage } from '../../application/ports';
export class RecoveryCipher {
  private readonly key: Buffer;
  constructor(secret: string) { this.key = createHash('sha256').update(`edutrack-recovery-outbox-v1:${secret}`).digest(); }
  seal(message: ResetMessage): string {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(message), 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64')).join('.');
  }
  open(payload: string): ResetMessage {
    const [iv, tag, ciphertext] = payload.split('.').map(value => Buffer.from(value, 'base64'));
    if (!iv || !tag || !ciphertext) throw new Error('Invalid recovery envelope');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')) as ResetMessage;
  }
}
