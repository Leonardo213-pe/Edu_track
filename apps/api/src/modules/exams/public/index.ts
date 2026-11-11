/** Durable event written in the same transaction that finalizes an attempt (transactional outbox). */
export const ATTEMPT_FINALIZED = 'AttemptFinalized.v1';
export interface AttemptFinalizedEvent {
  readonly eventId: string; readonly occurredAt: string; readonly schemaVersion: 1; readonly aggregateId: string; readonly correlationId: string;
  readonly attemptId: string; readonly assessmentId: string; readonly courseId: string; readonly studentId: string; readonly reason: 'STUDENT' | 'TIMEOUT';
}
