export const SUBMISSION_EVENTS = Symbol('SUBMISSION_EVENTS');
/** SubmissionReceived.v1: a new file version was durably stored (same transaction as the event). */
export interface SubmissionReceived {
  readonly type: 'SubmissionReceived.v1'; readonly submissionId: string; readonly fileId: string; readonly version: number;
  readonly assessmentId: string; readonly courseId: string; readonly studentId: string;
}
export interface SubmissionText { readonly fileId: string; readonly submissionId: string; readonly studentId: string; readonly text: string | null }
/**
 * Contract for asynchronous consumers (plagiarism): claim the next due event of the outbox with SKIP LOCKED, run the
 * handler and mark it processed, or schedule a retry with backoff if the handler throws. At-least-once delivery.
 */
export interface SubmissionEvents {
  processNext(handler: (event: SubmissionReceived) => Promise<void>): Promise<boolean>;
  /** Extracted text of a file version and of the current file of every submission of other students in the same course. */
  corpusFor(fileId: string): Promise<{ document: SubmissionText; others: SubmissionText[] } | null>;
  /** Outbox backlog (monitoring). */
  backlog(): Promise<{ pending: number; failing: number; oldestPendingSeconds: number | null }>;
}
