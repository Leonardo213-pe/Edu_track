import type { PlagiarismProvider } from '../../application/ports';
import { compare, type SimilarityResult } from '../../domain/similarity';

/**
 * SIMULADO: stand-in for the institutional plagiarism service (CAR-10). The report forbids building an own plagiarism
 * engine for production; this adapter only compares the submissions of the same course by word 3-grams so the flow
 * (outbox → asynchronous check → report → teacher review) works end to end. Replace it with the real provider's
 * adapter behind the same port. `failFirst` injects provider failures to exercise the outbox retries.
 */
export class SimulatedNgramPlagiarismProvider implements PlagiarismProvider {
  readonly name = 'SIMULADO-NGRAM-v1';
  private failures: number;
  constructor(failFirst = 0) { this.failures = failFirst; }
  async check(document: string, corpus: readonly { id: string; text: string }[]): Promise<SimilarityResult | null> {
    if (this.failures > 0) { this.failures--; throw new Error('SIMULATED_PROVIDER_UNAVAILABLE'); }
    return compare(document, corpus);
  }
}
