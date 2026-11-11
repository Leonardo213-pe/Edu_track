import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { blobStore, type BlobStore, type StorageSettings } from '../../../../platform/storage/blob-store';
import type { CourseStorage, FileInput, StoredFile } from '../../application/ports';
import { CourseError } from '../../domain/course';
const formats: Record<string, { mime: string; check(bytes: Buffer): boolean }> = {
  '.pdf': { mime: 'application/pdf', check: b => b.subarray(0, 5).toString() === '%PDF-' },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', check: b => b.readUInt32LE(0) === 0x04034b50 && b.includes(Buffer.from('[Content_Types].xml')) && b.includes(Buffer.from('word/')) },
  '.pptx': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', check: b => b.readUInt32LE(0) === 0x04034b50 && b.includes(Buffer.from('[Content_Types].xml')) && b.includes(Buffer.from('ppt/')) },
  '.txt': { mime: 'text/plain', check: b => !b.includes(0) && !new TextDecoder('utf-8', { fatal: true }).decode(b).includes('\u0000') },
  '.mp4': { mime: 'video/mp4', check: b => b.subarray(4, 8).toString() === 'ftyp' },
  '.webm': { mime: 'video/webm', check: b => b.readUInt32BE(0) === 0x1a45dfa3 },
};
/**
 * Course material files: validated by extension, declared MIME and content, stored under a random key. The bytes live
 * in a BlobStore: the local file system (same paths as before) or an S3-compatible bucket (cloud deployment).
 */
export class LocalCourseStorage implements CourseStorage {
  private constructor(private readonly store: BlobStore, private readonly prefix: string, private readonly maxBytes: number) {}
  /** Local root (e.g. storage/courses) or the configured object storage, under the "courses" prefix. */
  static create(settings: StorageSettings | undefined, localRoot: string, maxBytes = 25 * 1024 * 1024): LocalCourseStorage {
    const root = path.resolve(localRoot);
    return settings?.driver === 's3' ? new LocalCourseStorage(blobStore(settings, root), 'courses', maxBytes)
      : new LocalCourseStorage(blobStore(undefined, path.dirname(root)), path.basename(root), maxBytes);
  }
  private location(key: string): string {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new CourseError('NOT_FOUND');
    return `${this.prefix}/${key}`;
  }
  async put(input: FileInput): Promise<StoredFile> {
    const filename = input.filename.replace(/^.*[\\/]/, '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180);
    const format = formats[path.extname(filename).toLowerCase()]; const bytes = Buffer.from(input.bytes);
    if (!format || bytes.length < 4 || bytes.length > this.maxBytes || (input.mimeType !== format.mime && input.mimeType !== 'application/octet-stream')) throw new CourseError('FILE_REJECTED');
    try { if (!format.check(bytes)) throw new Error(); } catch { throw new CourseError('FILE_REJECTED'); }
    const key = randomUUID(); await this.store.put(this.location(key), bytes, format.mime);
    return { key, filename, mimeType: format.mime, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  async remove(key: string): Promise<void> { await this.store.delete(this.location(key)); }
  async read(key: string): Promise<Uint8Array> {
    const bytes = await this.store.get(this.location(key)); if (!bytes) throw new CourseError('NOT_FOUND'); return bytes;
  }
}
