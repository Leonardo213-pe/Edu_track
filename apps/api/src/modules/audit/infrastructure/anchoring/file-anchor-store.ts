import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AnchorStore, AuditAnchor } from '../../application/ports';

/**
 * Append-only JSON Lines file on a volume that is separate from the database volume (Compose: audit_anchors). Several
 * replicas may append the same head: duplicates are harmless for verification.
 */
export class FileAnchorStore implements AnchorStore {
  private readonly file: string;
  constructor(directory: string) { this.file = path.join(path.resolve(directory), 'audit-anchors.jsonl'); }
  async all(limit: number): Promise<AuditAnchor[]> {
    const text = await readFile(this.file, 'utf8').catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error; });
    return text.split('\n').filter(Boolean).slice(-limit).flatMap(line => { try { return [JSON.parse(line) as AuditAnchor]; } catch { return []; } });
  }
  async last(): Promise<AuditAnchor | null> { return (await this.all(1))[0] ?? null; }
  async append(anchor: AuditAnchor): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await appendFile(this.file, JSON.stringify(anchor) + '\n', { mode: 0o600 });
  }
}
