import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Technical object storage used by the modules' storage adapters (course materials, submissions, audit anchors).
 * Keys are relative paths such as "courses/<uuid>". Implementations: local file system or any S3-compatible service
 * (AWS S3, Cloudflare R2, MinIO). Modules keep their own validation and ports; this is plumbing only.
 */
export interface BlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** null when the object does not exist. */
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  /** Keys under a prefix, in lexicographic order. */
  list(prefix: string): Promise<string[]>;
}

const safeKey = (key: string) => {
  if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)+$/.test(key) || key.split('/').some(part => part === '..' || part === '.')) throw new Error('Invalid storage key');
  return key;
};

export class FileBlobStore implements BlobStore {
  constructor(private readonly root: string) {}
  private location(key: string) { return path.join(path.resolve(this.root), ...safeKey(key).split('/')); }
  async put(key: string, bytes: Uint8Array): Promise<void> {
    const file = this.location(key); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
  }
  async get(key: string): Promise<Uint8Array | null> {
    try { return await readFile(this.location(key)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async delete(key: string): Promise<void> { await unlink(this.location(key)).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
  async list(prefix: string): Promise<string[]> {
    const dir = path.join(path.resolve(this.root), ...prefix.replace(/\/$/, '').split('/'));
    const names = await readdir(dir).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [] as string[]; throw error; });
    return names.map(name => `${prefix.replace(/\/$/, '')}/${name}`).sort();
  }
}

export interface S3Config { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string }
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

interface Credentials { accessKeyId: string; secretAccessKey: string; sessionToken?: string; expiresAt?: number }
/**
 * Temporary credentials of the ECS task role (AWS_CONTAINER_CREDENTIALS_RELATIVE_URI), cached until 5 min before
 * they expire: no long-lived keys in the deployment. Only used when no static keys are configured.
 */
async function containerCredentials(env: NodeJS.ProcessEnv): Promise<Credentials> {
  const relative = env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  // FULL_URI is the standard alternative; only loopback hosts are accepted so a misconfiguration cannot leak requests.
  const full = env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
  if (full && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(full).hostname)) throw new Error('AWS_CONTAINER_CREDENTIALS_FULL_URI must be a loopback URL');
  if (!relative && !full) throw new Error('S3 credentials missing: configure access keys or run with an ECS task role');
  const response = await fetch(relative ? `http://169.254.170.2${relative}` : full!, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`ECS credentials endpoint failed: HTTP ${response.status}`);
  const body = await response.json() as { AccessKeyId: string; SecretAccessKey: string; Token: string; Expiration: string };
  return { accessKeyId: body.AccessKeyId, secretAccessKey: body.SecretAccessKey, sessionToken: body.Token, expiresAt: new Date(body.Expiration).getTime() };
}

/** Minimal S3 client (path-style requests signed with AWS Signature V4), enough for put/get/delete/list. */
export class S3BlobStore implements BlobStore {
  private cached?: Credentials;
  constructor(private readonly config: S3Config, private readonly now: () => Date = () => new Date(), private readonly env: NodeJS.ProcessEnv = process.env) {
    if (!/^https?:\/\//.test(config.endpoint) || !config.bucket || !!config.accessKeyId !== !!config.secretAccessKey) throw new Error('Invalid S3 configuration');
  }
  private async credentials(): Promise<Credentials> {
    if (this.config.accessKeyId) return { accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey };
    if (!this.cached || (this.cached.expiresAt ?? 0) - 300_000 < this.now().getTime()) this.cached = await containerCredentials(this.env);
    return this.cached;
  }
  private async request(method: 'GET' | 'PUT' | 'DELETE', key: string | null, query: Record<string, string> = {}, body?: Uint8Array, contentType?: string): Promise<Response> {
    const credentials = await this.credentials();
    const url = new URL(this.config.endpoint.replace(/\/$/, ''));
    const canonicalUri = `${url.pathname.replace(/\/$/, '')}/${encode(this.config.bucket)}${key ? `/${safeKey(key).split('/').map(encode).join('/')}` : ''}`;
    const canonicalQuery = Object.keys(query).sort().map(name => `${encode(name)}=${encode(query[name]!)}`).join('&');
    const payloadHash = sha256(body ?? '');
    const stamp = this.now().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); const date = stamp.slice(0, 8);
    const headers: Record<string, string> = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp, ...(contentType ? { 'content-type': contentType } : {}),
      ...(credentials.sessionToken ? { 'x-amz-security-token': credentials.sessionToken } : {}) };
    const names = Object.keys(headers).sort();
    const canonical = [method, canonicalUri, canonicalQuery, names.map(name => `${name}:${headers[name]}\n`).join(''), names.join(';'), payloadHash].join('\n');
    const scope = `${date}/${this.config.region}/s3/aws4_request`;
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, date), this.config.region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n')).digest('hex');
    const { host: _host, ...sent } = headers;
    return fetch(`${url.origin}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ''}`, { method, signal: AbortSignal.timeout(30_000),
      headers: { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` },
      ...(body ? { body: Buffer.from(body) } : {}) });
  }
  private async fail(response: Response, action: string): Promise<never> {
    const text = (await response.text().catch(() => '')).match(/<Code>([^<]+)<\/Code>/)?.[1] ?? '';
    throw new Error(`S3 ${action} failed: HTTP ${response.status} ${text}`.trim());
  }
  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const response = await this.request('PUT', key, {}, bytes, contentType); if (!response.ok) await this.fail(response, 'put');
  }
  async get(key: string): Promise<Uint8Array | null> {
    const response = await this.request('GET', key);
    if (response.status === 404) return null; if (!response.ok) await this.fail(response, 'get');
    return new Uint8Array(await response.arrayBuffer());
  }
  async delete(key: string): Promise<void> {
    const response = await this.request('DELETE', key); if (!response.ok && response.status !== 404) await this.fail(response, 'delete');
  }
  async list(prefix: string): Promise<string[]> {
    const keys: string[] = []; let token: string | undefined;
    do {
      const response = await this.request('GET', null, { 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) });
      if (!response.ok) await this.fail(response, 'list');
      const xml = await response.text();
      keys.push(...[...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(match => match[1]!.replace(/&amp;/g, '&')));
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1] : undefined;
    } while (token);
    return keys.sort();
  }
}

export interface StorageSettings { driver: 'local' | 's3'; root?: string; s3?: S3Config }
/** Builds the configured store; the local driver keeps one directory per module (the previous behaviour). */
export function blobStore(settings: StorageSettings | undefined, localRoot: string): BlobStore {
  return settings?.driver === 's3' && settings.s3 ? new S3BlobStore(settings.s3) : new FileBlobStore(localRoot);
}
