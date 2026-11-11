import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FileInput, StoredFile, SubmissionStorage } from '../../application/ports';
import { MAX_SUBMISSION_BYTES, SubmissionError } from '../../domain/submission';

// Same pattern as the course material storage (ADR-006): extension + declared MIME + magic bytes, random key, 0600.
const formats: Record<string, { mime: string; check(bytes: Buffer): boolean }> = {
  '.pdf': { mime: 'application/pdf', check: b => b.subarray(0, 5).toString() === '%PDF-' },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', check: b => b.readUInt32LE(0) === 0x04034b50 && b.includes(Buffer.from('[Content_Types].xml')) && b.includes(Buffer.from('word/')) },
  '.txt': { mime: 'text/plain', check: b => !b.includes(0) && !new TextDecoder('utf-8', { fatal: true }).decode(b).includes('\u0000') },
};
export class LocalSubmissionStorage implements SubmissionStorage {
  constructor(private readonly root: string, private readonly maxBytes = MAX_SUBMISSION_BYTES) {}
  private location(key: string): string {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new SubmissionError('NOT_FOUND');
    return path.join(path.resolve(this.root), key);
  }
  async put(input: FileInput): Promise<StoredFile> {
    const filename = input.filename.replace(/^.*[\\/]/, '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180);
    const format = formats[path.extname(filename).toLowerCase()]; const bytes = Buffer.from(input.bytes);
    if (!format || bytes.length < 4 || bytes.length > this.maxBytes || (input.mimeType !== format.mime && input.mimeType !== 'application/octet-stream')) throw new SubmissionError('FILE_REJECTED');
    try { if (!format.check(bytes)) throw new Error(); } catch { throw new SubmissionError('FILE_REJECTED'); }
    const key = randomUUID(); await mkdir(this.root, { recursive: true }); await writeFile(this.location(key), bytes, { flag: 'wx', mode: 0o600 });
    return { key, filename, mimeType: format.mime, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  async remove(key: string): Promise<void> { await unlink(this.location(key)).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
  async read(key: string): Promise<Uint8Array> {
    try { return await readFile(this.location(key)); } catch (error) { if (error instanceof SubmissionError) throw error; throw new SubmissionError('NOT_FOUND'); }
  }
}
