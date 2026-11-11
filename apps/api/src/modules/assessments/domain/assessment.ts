import { AssessmentError, text, toCents, type QuestionData, type QuestionOption, type QuestionType } from './question';

export type AssessmentType = 'QUIZ' | 'RUBRIC';
export type AssessmentStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED';
export interface Criterion { readonly id: string; readonly description: string; readonly maxPointsCents: number }
export interface SnapshotQuestion {
  readonly questionId: string; readonly position: number; readonly type: QuestionType; readonly statement: string;
  readonly pointsCents: number; readonly options: readonly QuestionOption[];
}
export interface AssessmentData {
  id: string; courseId: string; title: string; instructions: string; type: AssessmentType; weightBp: number; dueAt: string;
  durationMinutes: number | null; questionCount: number | null; bankId: string | null; criteria: Criterion[];
  status: AssessmentStatus; revision: number; publishedAt: string | null; createdAt: string;
}
export interface AssessmentInput {
  title: string; instructions: string; type: AssessmentType; weight: number; dueAt: string;
  durationMinutes?: number | null; questionCount?: number | null; bankId?: string | null; criteria?: { id?: string; description: string; maxPoints: number }[];
}
export const MAX_WEIGHT_BP = 10000;

// State: each phase decides what may change, whether grades are accepted and whether students see the assessment.
interface AssessmentState {
  readonly status: AssessmentStatus;
  allowsDefinitionChanges(): boolean;
  allowsScheduleChanges(): boolean;
  accepting(): boolean;
  visibleToStudents(): boolean;
}
const states: Record<AssessmentStatus, AssessmentState> = {
  DRAFT: { status: 'DRAFT', allowsDefinitionChanges: () => true, allowsScheduleChanges: () => true, accepting: () => false, visibleToStudents: () => false },
  PUBLISHED: { status: 'PUBLISHED', allowsDefinitionChanges: () => false, allowsScheduleChanges: () => true, accepting: () => true, visibleToStudents: () => true },
  CLOSED: { status: 'CLOSED', allowsDefinitionChanges: () => false, allowsScheduleChanges: () => false, accepting: () => true, visibleToStudents: () => true },
};

function instant(value: unknown): string {
  const date = typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) throw new AssessmentError('INVALID_INPUT');
  return date.toISOString();
}
function bounded(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new AssessmentError('INVALID_INPUT');
  return value;
}

export class Assessment {
  private constructor(private readonly state: AssessmentData) {}
  static restore(data: AssessmentData): Assessment { return new Assessment(structuredClone(data)); }
  static create(id: string, courseId: string, input: AssessmentInput, newId: () => string, now: string): Assessment {
    return new Assessment({ id, courseId, ...Assessment.definition(input, newId), status: 'DRAFT', revision: 0, publishedAt: null, createdAt: now });
  }
  private static definition(input: AssessmentInput, newId: () => string) {
    if (input.type !== 'QUIZ' && input.type !== 'RUBRIC') throw new AssessmentError('INVALID_INPUT');
    const quiz = input.type === 'QUIZ';
    const criteria = quiz ? [] : (input.criteria ?? []).map(item => ({
      id: item.id && /^[\w-]{1,40}$/.test(item.id) ? item.id : newId(), description: text(item.description, 500), maxPointsCents: toCents(item.maxPoints, 1, 10000) }));
    if (!quiz && (criteria.length < 1 || criteria.length > 20 || new Set(criteria.map(item => item.id)).size !== criteria.length)) throw new AssessmentError('INVALID_INPUT');
    if (quiz && (typeof input.bankId !== 'string' || !input.bankId)) throw new AssessmentError('INVALID_INPUT');
    return {
      title: text(input.title, 160), instructions: text(input.instructions ?? '', 5000, true), type: input.type,
      weightBp: toCents(input.weight, 1, MAX_WEIGHT_BP), dueAt: instant(input.dueAt),
      durationMinutes: quiz ? bounded(input.durationMinutes, 1, 1440) : null, questionCount: quiz ? bounded(input.questionCount, 1, 200) : null,
      bankId: quiz ? input.bankId! : null, criteria,
    };
  }
  get data(): Readonly<AssessmentData> { return this.state; }
  snapshot(): AssessmentData { return structuredClone(this.state); }
  private get lifecycle(): AssessmentState { return states[this.state.status]; }
  visibleToStudents(): boolean { return this.lifecycle.visibleToStudents(); }
  acceptsGrades(): boolean { return this.lifecycle.accepting(); }
  advanceRevision(): void { this.state.revision++; }
  maxRubricCents(): number { return this.state.criteria.reduce((sum, item) => sum + item.maxPointsCents, 0); }

  /** Drafts change freely; a published assessment only changes its schedule (title, instructions, weight, due date), always audited. */
  edit(input: AssessmentInput, newId: () => string): void {
    if (!this.lifecycle.allowsScheduleChanges()) throw new AssessmentError('INVALID_STATE');
    const next = Assessment.definition(input, newId);
    if (!this.lifecycle.allowsDefinitionChanges()) {
      const frozen = (['type', 'durationMinutes', 'questionCount', 'bankId'] as const).some(key => next[key] !== this.state[key])
        || JSON.stringify(next.criteria.map(({ id, ...rest }) => rest)) !== JSON.stringify(this.state.criteria.map(({ id, ...rest }) => rest));
      if (frozen) throw new AssessmentError('INVALID_STATE');
      Object.assign(this.state, { title: next.title, instructions: next.instructions, weightBp: next.weightBp, dueAt: next.dueAt });
      return;
    }
    Object.assign(this.state, next);
  }
  /** Publishing freezes the question pool: later bank edits never alter what this assessment draws from. */
  publish(pool: readonly QuestionData[], courseVisible: boolean, now: string): SnapshotQuestion[] {
    if (this.state.status !== 'DRAFT') throw new AssessmentError('INVALID_STATE');
    if (!courseVisible) throw new AssessmentError('COURSE_NOT_PUBLISHED');
    let snapshot: SnapshotQuestion[] = [];
    if (this.state.type === 'QUIZ') {
      const active = pool.filter(question => question.active && question.bankId === this.state.bankId);
      if (active.length < this.state.questionCount!) throw new AssessmentError('INSUFFICIENT_QUESTIONS');
      snapshot = active.map((question, position) => ({ questionId: question.id, position, type: question.type, statement: question.statement,
        pointsCents: question.pointsCents, options: question.options.map(option => ({ ...option })) }));
    }
    this.state.status = 'PUBLISHED'; this.state.publishedAt = now;
    return snapshot;
  }
  close(): void { if (this.state.status !== 'PUBLISHED') throw new AssessmentError('INVALID_STATE'); this.state.status = 'CLOSED'; }
  removable(): void { if (this.state.status !== 'DRAFT') throw new AssessmentError('INVALID_STATE'); }
  /** Student-facing view: definition and schedule only, never questions or answers. */
  publicView() {
    const { bankId, revision, createdAt, ...rest } = this.snapshot();
    return rest;
  }
}

/** Sum of course weights must never exceed 100%. */
export function ensureWeights(assessments: readonly Assessment[], candidate: Assessment): void {
  const total = assessments.filter(item => item.data.id !== candidate.data.id).reduce((sum, item) => sum + item.data.weightBp, 0) + candidate.data.weightBp;
  if (total > MAX_WEIGHT_BP) throw new AssessmentError('WEIGHT_EXCEEDED');
}

/** Random draw without repetition (partial Fisher–Yates); the random source is injected for reproducible tests. */
export function draw<T>(pool: readonly T[], count: number, random: () => number): T[] {
  if (!Number.isInteger(count) || count < 1 || count > pool.length) throw new AssessmentError('INSUFFICIENT_QUESTIONS');
  const items = [...pool];
  for (let index = 0; index < count; index++) {
    const pick = index + Math.floor(random() * (items.length - index));
    [items[index], items[pick]] = [items[pick]!, items[index]!];
  }
  return items.slice(0, count);
}
