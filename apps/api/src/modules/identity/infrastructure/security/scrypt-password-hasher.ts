import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { PasswordHasher } from '../../application/ports';
const N = 131072, r = 8, p = 1;
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64,
    { N, r, p, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
export class ScryptPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    return `scrypt$${N}$${r}$${p}$${salt}$${(await derive(password, salt)).toString('hex')}`;
  }
  async verify(password: string, encoded: string): Promise<boolean> {
    const [algorithm, cost, block, parallel, salt, digest, extra] = encoded.split('$');
    if (algorithm !== 'scrypt' || cost !== `${N}` || block !== `${r}` || parallel !== `${p}` ||
      !salt || !/^[a-f0-9]{32}$/.test(salt) || !digest || !/^[a-f0-9]{128}$/.test(digest) || extra !== undefined) return false;
    const actual = await derive(password, salt);
    return timingSafeEqual(actual, Buffer.from(digest, 'hex'));
  }
}
