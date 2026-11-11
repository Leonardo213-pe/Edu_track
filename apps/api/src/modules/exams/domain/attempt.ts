export type ExamErrorCode = 'INVALID_INPUT' | 'FORBIDDEN' | 'NOT_FOUND' | 'NOT_AVAILABLE' | 'ATTEMPT_CLOSED';
export class ExamError extends Error {
  constructor(readonly code: ExamErrorCode) { super(code); }
}
export type QuestionType = 'SINGLE' | 'MULTIPLE' | 'TRUE_FALSE';
/** A drawn question as the student receives it: never includes which options are correct. */
export interface AttemptQuestion {
  readonly questionId: string; readonly position: number; readonly type: QuestionType; readonly statement: string;
  readonly pointsCents: number; readonly options: readonly { readonly id: string; readonly text: string }[];
}
export type AttemptStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED';
export interface AttemptData {
  readonly id: string; readonly assessmentId: string; readonly courseId: string; readonly studentId: string; readonly status: AttemptStatus;
  readonly startedAt: string; readonly expiresAt: string; readonly finalizedAt: string | null; readonly finalizedBy: 'STUDENT' | 'TIMEOUT' | null;
  readonly questions: readonly AttemptQuestion[];
}
export interface SavedAnswer { readonly questionId: string; readonly optionIds: readonly string[]; readonly version: number; readonly savedAt: string }
export interface ExamDefinition {
  readonly id: string; readonly courseId: string; readonly title: string; readonly status: string; readonly type: string;
  readonly dueAt: string; readonly durationMinutes: number | null; readonly questionCount: number | null;
}

/** The server fixes the deadline: the shorter of start + duration and the assessment due date (CU-03 step 1). */
export function expiryFor(startedAt: Date, durationMinutes: number, dueAt: Date): Date {
  return new Date(Math.min(startedAt.getTime() + durationMinutes * 60_000, dueAt.getTime()));
}
/** Client versions are positive, monotonic per question; the store accepts only a greater version (idempotent retries). */
export function validVersion(version: unknown): number {
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) throw new ExamError('INVALID_INPUT');
  return version;
}

export class Attempt {
  private constructor(readonly data: AttemptData) {}
  static restore(data: AttemptData): Attempt { return new Attempt(data); }
  /** Only published quizzes, before their due date, with a non-empty draw. */
  static start(id: string, definition: ExamDefinition, studentId: string, questions: readonly AttemptQuestion[], now: Date): Attempt {
    if (definition.type !== 'QUIZ' || definition.status !== 'PUBLISHED' || !definition.durationMinutes) throw new ExamError('NOT_AVAILABLE');
    const dueAt = new Date(definition.dueAt);
    if (now.getTime() >= dueAt.getTime()) throw new ExamError('NOT_AVAILABLE');
    if (!questions.length || questions.some(question => question.options.some(option => 'correct' in option))) throw new ExamError('INVALID_INPUT');
    return new Attempt({ id, assessmentId: definition.id, courseId: definition.courseId, studentId, status: 'IN_PROGRESS', startedAt: now.toISOString(),
      expiresAt: expiryFor(now, definition.durationMinutes, dueAt).toISOString(), finalizedAt: null, finalizedBy: null,
      questions: questions.map((question, position) => ({ ...question, position, options: question.options.map(({ id: optionId, text }) => ({ id: optionId, text })) })) });
  }
  ownedBy(studentId: string): void { if (this.data.studentId !== studentId) throw new ExamError('FORBIDDEN'); }
  isOpen(now: Date): boolean { return this.data.status === 'IN_PROGRESS' && now.getTime() < new Date(this.data.expiresAt).getTime(); }
  remainingSeconds(now: Date): number { return this.isOpen(now) ? Math.ceil((new Date(this.data.expiresAt).getTime() - now.getTime()) / 1000) : 0; }
  /** Normalizes a selection: options of that question only, at most one for single-choice/true-false; empty clears the answer. */
  validateAnswer(questionId: string, optionIds: unknown): string[] {
    const question = this.data.questions.find(item => item.questionId === questionId);
    if (!question) throw new ExamError('NOT_FOUND');
    if (!Array.isArray(optionIds) || optionIds.some(id => typeof id !== 'string')) throw new ExamError('INVALID_INPUT');
    const selected = [...new Set(optionIds as string[])].sort();
    if (selected.some(id => !question.options.some(option => option.id === id))) throw new ExamError('INVALID_INPUT');
    if (question.type !== 'MULTIPLE' && selected.length > 1) throw new ExamError('INVALID_INPUT');
    return selected;
  }
}
