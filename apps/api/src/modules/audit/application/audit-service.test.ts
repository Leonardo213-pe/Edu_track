import { describe, expect, it } from 'vitest';
import { AuditService } from './audit-service';
import { auditPage, changedFields, type AuditEntry } from '../domain/audit';

const entry: AuditEntry = { id: '7', entity: 'GRADE', entityId: '00000000-0000-4000-8000-000000000001', action: 'UPDATE', actorId: 'teacher', occurredAt: '2026-11-13T00:00:00.000Z',
  before: { scoreCents: 1500, reason: 'Calificación inicial', version: 0 }, after: { scoreCents: 1600, reason: 'Revisión', version: 1 }, prevHash: '0'.repeat(64), hash: 'a'.repeat(64) };
describe('audit (CU-14)', () => {
  it('describes field changes before → after, ignoring technical version counters', () => {
    expect(changedFields(entry.before, entry.after)).toEqual([{ field: 'reason', before: 'Calificación inicial', after: 'Revisión' }, { field: 'scoreCents', before: 1500, after: 1600 }]);
    expect(changedFields(null, { scoreCents: 1 })).toEqual([{ field: 'scoreCents', before: null, after: 1 }]);
    for (const [limit, offset] of [[0, 0], [201, 0], [10, -1], [1.5, 0]]) expect(() => auditPage(limit!, offset!)).toThrow('INVALID_INPUT');
  });
  it('lets only administrators list entries and verify the hash chain', async () => {
    const filters: unknown[] = [];
    const service = new AuditService({ list: async (filter) => { filters.push(filter); return [entry]; }, verify: async () => ({ checked: 3, valid: true, firstInvalidId: null }),
      head: async () => null, hashesOf: async () => new Map() },
      { role: async id => id === 'admin' ? 'ADMIN' : 'TEACHER', names: async () => new Map([['teacher', 'Docente']]) });
    const [listed] = await service.entries('admin', { entity: 'GRADE' }, 10, 0);
    expect(listed).toMatchObject({ actorName: 'Docente', changes: [{ field: 'reason' }, { field: 'scoreCents' }] }); expect(filters).toEqual([{ entity: 'GRADE' }]);
    expect(await service.verify('admin')).toEqual({ checked: 3, valid: true, firstInvalidId: null });
    await expect(service.entries('teacher', {})).rejects.toThrow('FORBIDDEN'); await expect(service.verify('teacher')).rejects.toThrow('FORBIDDEN');
    await expect(service.entries('admin', { entity: 'USER' })).rejects.toThrow('INVALID_INPUT');
    expect(await service.anchor()).toBeNull(); expect(await service.lastAnchor()).toBeNull();
    expect(await service.verifyAnchors('admin')).toMatchObject({ configured: false, anchors: 0, valid: true });
  });
  it('anchors the chain head outside the database once and detects a rewritten chain', async () => {
    // Explicit doubles: the chain lives in PostgreSQL and anchors in a file on a separate volume (integration tests).
    let head: { id: string; hash: string } | null = null; const chain = new Map<string, string>(); const stored: { entryId: string; hash: string; anchoredAt: string }[] = [];
    const service = new AuditService({ list: async () => [], verify: async () => ({ checked: 0, valid: true, firstInvalidId: null }), head: async () => head,
      hashesOf: async ids => new Map(ids.filter(id => chain.has(id)).map(id => [id, chain.get(id)!])) },
    { role: async id => id === 'admin' ? 'ADMIN' : 'TEACHER', names: async () => new Map() },
    { last: async () => stored.at(-1) ?? null, append: async anchor => { stored.push(anchor); }, all: async limit => stored.slice(-limit) }, { now: () => '2026-11-20T00:00:00.000Z' });
    expect(await service.anchor()).toBeNull();
    head = { id: '5', hash: 'h5' }; chain.set('5', 'h5');
    expect(await service.anchor()).toEqual({ entryId: '5', hash: 'h5', anchoredAt: '2026-11-20T00:00:00.000Z' });
    expect(await service.anchor()).toBeNull();
    expect(await service.lastAnchor()).toEqual({ entryId: '5', anchoredAt: '2026-11-20T00:00:00.000Z' });
    expect(await service.verifyAnchors('admin')).toMatchObject({ configured: true, anchors: 1, valid: true });
    chain.set('5', 'rewritten');
    expect(await service.verifyAnchors('admin')).toMatchObject({ valid: false, firstMismatch: { entryId: '5' } });
    await expect(service.verifyAnchors('teacher')).rejects.toThrow('FORBIDDEN');
  });
});
