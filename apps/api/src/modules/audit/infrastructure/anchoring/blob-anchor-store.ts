import type { BlobStore } from '../../../../platform/storage/blob-store';
import type { AnchorStore, AuditAnchor } from '../../application/ports';

/**
 * Audit anchors as one immutable object per anchor in an S3-compatible bucket (cloud deployment): outside the
 * database and its provider. Keys sort by entry ID, so the last key is the latest anchor.
 */
export class BlobAnchorStore implements AnchorStore {
  constructor(private readonly store: BlobStore) {}
  private key(anchor: AuditAnchor) { return `anchors/${anchor.entryId.padStart(15, '0')}-${anchor.anchoredAt.replace(/[^0-9]/g, '')}.json`; }
  async all(limit: number): Promise<AuditAnchor[]> {
    const keys = (await this.store.list('anchors/')).slice(-limit); const anchors: AuditAnchor[] = [];
    for (const key of keys) { const bytes = await this.store.get(key); if (bytes) anchors.push(JSON.parse(Buffer.from(bytes).toString('utf8')) as AuditAnchor); }
    return anchors;
  }
  async last(): Promise<AuditAnchor | null> { return (await this.all(1))[0] ?? null; }
  async append(anchor: AuditAnchor): Promise<void> { await this.store.put(this.key(anchor), Buffer.from(JSON.stringify(anchor)), 'application/json'); }
}
