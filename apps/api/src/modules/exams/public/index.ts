export const EXAM_MONITOR = Symbol('EXAM_MONITOR');
/** Operational view for monitoring (CAR-14): attempts in progress and the AttemptFinalized outbox backlog. */
export interface ExamMonitor {
  snapshot(): Promise<{ activeAttempts: number; outbox: { pending: number; failing: number; oldestPendingSeconds: number | null } }>;
}
/** Durable event written in the same transaction that finalizes an attempt (transactional outbox). */
export const ATTEMPT_FINALIZED = 'AttemptFinalized.v1';
export interface AttemptFinalizedEvent {
  readonly eventId: string; readonly occurredAt: string; readonly schemaVersion: 1; readonly aggregateId: string; readonly correlationId: string;
  readonly attemptId: string; readonly assessmentId: string; readonly courseId: string; readonly studentId: string; readonly reason: 'STUDENT' | 'TIMEOUT';
}
