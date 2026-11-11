import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
export class LocalCourseStorage implements CourseStorage {
  constructor(private readonly root: string, private readonly maxBytes = 25 * 1024 * 1024) {}
  private location(key: string): string {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new CourseError('NOT_FOUND');
    return path.join(path.resolve(this.root), key);
  }
  async put(input: FileInput): Promise<StoredFile> {
    const filename = input.filename.replace(/^.*[\\/]/, '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180);
    const format = formats[path.extname(filename).toLowerCase()]; const bytes = Buffer.from(input.bytes);
    if (!format || bytes.length < 4 || bytes.length > this.maxBytes || (input.mimeType !== format.mime && input.mimeType !== 'application/octet-stream')) throw new CourseError('FILE_REJECTED');
    try { if (!format.check(bytes)) throw new Error(); } catch { throw new CourseError('FILE_REJECTED'); }
    const key = randomUUID(); await mkdir(this.root, { recursive: true }); await writeFile(this.location(key), bytes, { flag: 'wx', mode: 0o600 });
    return { key, filename, mimeType: format.mime, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  async remove(key: string): Promise<void> { await unlink(this.location(key)).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
  async read(key: string): Promise<Uint8Array> {
    try { return await readFile(this.location(key)); } catch (error) { if (error instanceof CourseError) throw error; throw new CourseError('NOT_FOUND'); }
  }
}
