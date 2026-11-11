import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { blobStore, type BlobStore, type StorageSettings } from '../../../../platform/storage/blob-store';
import type { FileInput, StoredFile, SubmissionStorage } from '../../application/ports';
import { MAX_SUBMISSION_BYTES, SubmissionError } from '../../domain/submission';

// Same pattern as the course material storage (ADR-006): extension + declared MIME + magic bytes, random key.
const formats: Record<string, { mime: string; check(bytes: Buffer): boolean }> = {
  '.pdf': { mime: 'application/pdf', check: b => b.subarray(0, 5).toString() === '%PDF-' },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', check: b => b.readUInt32LE(0) === 0x04034b50 && b.includes(Buffer.from('[Content_Types].xml')) && b.includes(Buffer.from('word/')) },
  '.txt': { mime: 'text/plain', check: b => !b.includes(0) && !new TextDecoder('utf-8', { fatal: true }).decode(b).includes('\u0000') },
};
/** Submission files in a BlobStore: local file system (same paths as before) or an S3-compatible bucket. */
export class LocalSubmissionStorage implements SubmissionStorage {
  private constructor(private readonly store: BlobStore, private readonly prefix: string, private readonly maxBytes: number) {}
  static create(settings: StorageSettings | undefined, localRoot: string, maxBytes = MAX_SUBMISSION_BYTES): LocalSubmissionStorage {
    const root = path.resolve(localRoot);
    return settings?.driver === 's3' ? new LocalSubmissionStorage(blobStore(settings, root), 'submissions', maxBytes)
      : new LocalSubmissionStorage(blobStore(undefined, path.dirname(root)), path.basename(root), maxBytes);
  }
  private location(key: string): string {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new SubmissionError('NOT_FOUND');
    return `${this.prefix}/${key}`;
  }
  async put(input: FileInput): Promise<StoredFile> {
    const filename = input.filename.replace(/^.*[\\/]/, '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180);
    const format = formats[path.extname(filename).toLowerCase()]; const bytes = Buffer.from(input.bytes);
    if (!format || bytes.length < 4 || bytes.length > this.maxBytes || (input.mimeType !== format.mime && input.mimeType !== 'application/octet-stream')) throw new SubmissionError('FILE_REJECTED');
    try { if (!format.check(bytes)) throw new Error(); } catch { throw new SubmissionError('FILE_REJECTED'); }
    const key = randomUUID(); await this.store.put(this.location(key), bytes, format.mime);
    return { key, filename, mimeType: format.mime, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  async remove(key: string): Promise<void> { await this.store.delete(this.location(key)); }
  async read(key: string): Promise<Uint8Array> {
    const bytes = await this.store.get(this.location(key)); if (!bytes) throw new SubmissionError('NOT_FOUND'); return bytes;
  }
}
