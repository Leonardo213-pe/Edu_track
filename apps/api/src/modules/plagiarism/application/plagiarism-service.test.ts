import { beforeEach, describe, expect, it } from 'vitest';
import { PlagiarismService } from './plagiarism-service';
import { compare, containmentBp, ngrams, tokens } from '../domain/similarity';
import type { CorpusText, ReportRecord } from './ports';

const original = 'La fotosíntesis convierte la energía luminosa en energía química dentro de los cloroplastos de las plantas verdes';
const copy = 'Como sabemos la fotosintesis convierte la energia luminosa en energia quimica dentro de los cloroplastos de las plantas verdes';
const unrelated = 'El ciclo del agua describe la evaporación, condensación y precipitación sobre la superficie terrestre';
let saved: ReportRecord[], corpus: { document: CorpusText; others: CorpusText[] } | null, providerCalls: number, failNext: boolean, service: PlagiarismService;
const event = { type: 'SubmissionReceived.v1', submissionId: 's-ana', fileId: 'f-ana', assessmentId: 'a1', courseId: 'c1', studentId: 'ana' };

beforeEach(() => {
  saved = []; providerCalls = 0; failNext = false;
  corpus = { document: { fileId: 'f-ana', submissionId: 's-ana', studentId: 'ana', text: copy },
    others: [{ fileId: 'f-beto', submissionId: 's-beto', studentId: 'beto', text: original }, { fileId: 'f-carla', submissionId: 's-carla', studentId: 'carla', text: unrelated },
      { fileId: 'f-dani', submissionId: 's-dani', studentId: 'dani', text: null }] };
  let id = 0;
  // Explicit doubles of the report store, the submissions contract, the provider and identity/catalog contracts.
  service = new PlagiarismService({ exists: async fileId => saved.some(report => report.fileId === fileId), save: async report => { saved.push(report); },
    forAssessment: async assessmentId => saved.filter(report => report.assessmentId === assessmentId) },
  { corpusFor: async () => corpus },
  { name: 'SIMULADO-NGRAM-v1', check: async (document, items) => { providerCalls++; if (failNext) throw new Error('down'); return compare(document, items); } },
  { assessment: async idValue => idValue === 'a1' ? { id: 'a1', courseId: 'c1' } : null, course: async () => ({ teacherId: 'teacher' }) },
  { role: async userId => ({ teacher: 'TEACHER', other: 'TEACHER', admin: 'ADMIN', ana: 'STUDENT' } as Record<string, string>)[userId] ?? null,
    names: async ids => new Map(ids.map(value => [value, value.toUpperCase()])) },
  { id: () => `r${++id}`, now: () => '2026-11-20T00:00:00.000Z' });
});

describe('n-gram similarity', () => {
  it('normalizes accents and case and measures containment of 3-grams', () => {
    expect(tokens('Energía QUÍMICA, ñandú!')).toEqual(['energia', 'quimica', 'nandu']);
    expect([...ngrams('a b c d')]).toEqual(['a b c', 'b c d']);
    expect(containmentBp(ngrams('a b c d'), ngrams('x a b c'))).toBe(5000);
    expect(containmentBp(new Set(), ngrams('a b c'))).toBe(0);
    expect(compare('muy corto', [{ id: 'x', text: 'muy corto' }])).toBeNull();
    const result = compare(copy, [{ id: 'orig', text: original }, { id: 'other', text: unrelated }])!;
    expect(result.similarityBp).toBeGreaterThan(8000); expect(result.matches.map(match => match.id)).toEqual(['orig']);
    expect(compare(unrelated, [{ id: 'orig', text: original }])).toEqual({ similarityBp: 0, matches: [] });
  });
});
describe('plagiarism consumer', () => {
  it('stores one report per file with the highest similarity and its sources, ignoring texts it cannot compare', async () => {
    await service.handle(event);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ fileId: 'f-ana', status: 'COMPLETED', provider: 'SIMULADO-NGRAM-v1', comparedWith: 2, matches: [{ submissionId: 's-beto', studentId: 'beto' }] });
    expect(saved[0]!.similarityBp).toBeGreaterThan(8000);
  });
  it('is idempotent: a redelivered event never calls the provider again', async () => {
    await service.handle(event); await service.handle(event);
    expect(saved).toHaveLength(1); expect(providerCalls).toBe(1);
  });
  it('propagates provider failures so the outbox retries, then succeeds', async () => {
    failNext = true; await expect(service.handle(event)).rejects.toThrow('down'); expect(saved).toHaveLength(0);
    failNext = false; await service.handle(event); expect(saved).toHaveLength(1);
  });
  it('marks files without extractable text as UNSUPPORTED and ignores unknown events or files', async () => {
    corpus!.document.text = null; await service.handle(event);
    expect(saved[0]).toMatchObject({ status: 'UNSUPPORTED', similarityBp: null, matches: [] });
    await service.handle({ ...event, type: 'Other', fileId: 'x' });
    corpus = null; await service.handle({ ...event, fileId: 'gone' });
    expect(saved).toHaveLength(1);
  });
  it('shows reports only to the responsible teacher and ADMIN, as percentages with names', async () => {
    await service.handle(event);
    const view = await service.forAssessment('teacher', 'a1');
    expect(view).toMatchObject({ simulated: true, reports: [{ studentId: 'ana', status: 'COMPLETED', matches: [{ displayName: 'BETO' }] }] });
    expect(view.reports[0]!.similarity).toBeGreaterThan(80);
    await expect(service.forAssessment('admin', 'a1')).resolves.toBeTruthy();
    await expect(service.forAssessment('other', 'a1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.forAssessment('ana', 'a1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.forAssessment('teacher', 'missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
