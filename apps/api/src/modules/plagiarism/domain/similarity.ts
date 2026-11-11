/** Text similarity by word n-grams (used by the SIMULATED provider; a real provider replaces it behind the port). */
export const NGRAM = 3;
export const MAX_MATCHES = 5;
export interface SimilarityMatch { readonly id: string; readonly similarityBp: number }
export interface SimilarityResult { readonly similarityBp: number; readonly matches: readonly SimilarityMatch[] }

export function tokens(text: string): string[] {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
export function ngrams(text: string, size = NGRAM): Set<string> {
  const words = tokens(text); const result = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) result.add(words.slice(i, i + size).join(' '));
  return result;
}
/** Share of the document's n-grams that also appear in the other text, in basis points (0–10000). */
export function containmentBp(document: ReadonlySet<string>, other: ReadonlySet<string>): number {
  if (!document.size) return 0;
  let shared = 0; for (const gram of document) if (other.has(gram)) shared++;
  return Math.round(shared * 10_000 / document.size);
}
/**
 * Overall similarity = highest containment against any other text (a copy from a single source is what matters);
 * returns null when the document is too short to compare.
 */
export function compare(document: string, corpus: readonly { id: string; text: string }[]): SimilarityResult | null {
  const grams = ngrams(document); if (!grams.size) return null;
  const matches = corpus.map(item => ({ id: item.id, similarityBp: containmentBp(grams, ngrams(item.text)) }))
    .filter(match => match.similarityBp > 0).sort((a, b) => b.similarityBp - a.similarityBp || a.id.localeCompare(b.id));
  return { similarityBp: matches[0]?.similarityBp ?? 0, matches: matches.slice(0, MAX_MATCHES) };
}
