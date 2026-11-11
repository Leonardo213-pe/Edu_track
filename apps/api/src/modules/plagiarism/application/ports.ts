import type { SimilarityResult } from '../domain/similarity';

/** Outbound port to the plagiarism checker (CAR-10). The institutional provider contract is pending; locally SIMULATED. */
export interface PlagiarismProvider {
  readonly name: string;
  /** Throws on provider failures (the outbox consumer retries with backoff); null when the text cannot be compared. */
  check(document: string, corpus: readonly { id: string; text: string }[]): Promise<SimilarityResult | null>;
}
export interface ReportRecord {
  id: string; fileId: string; submissionId: string; assessmentId: string; courseId: string; studentId: string;
  status: 'COMPLETED' | 'UNSUPPORTED'; similarityBp: number | null; matches: { submissionId: string; studentId: string; similarityBp: number }[];
  provider: string; comparedWith: number; createdAt: string;
}
export interface ReportRepository {
  exists(fileId: string): Promise<boolean>;
  /** Inserts once per file (unique file ID): redelivered events never create a second report. */
  save(report: ReportRecord): Promise<void>;
  forAssessment(assessmentId: string): Promise<ReportRecord[]>;
}
export interface PlagiarismCatalog {
  assessment(id: string): Promise<{ id: string; courseId: string } | null>;
  course(id: string): Promise<{ teacherId: string } | null>;
}
export interface PlagiarismDirectory {
  role(id: string): Promise<string | null>;
  names(ids: string[]): Promise<Map<string, string>>;
}
export interface PlagiarismRuntime { id(): string; now(): string }
/** SubmissionReceived.v1 as consumed here (mapped from the submissions contract in the composition root). */
export interface ReceivedSubmission { type: string; submissionId: string; fileId: string; assessmentId: string; courseId: string; studentId: string }
export interface CorpusText { fileId: string; submissionId: string; studentId: string; text: string | null }
export interface CorpusSource { corpusFor(fileId: string): Promise<{ document: CorpusText; others: CorpusText[] } | null> }
