export class GradingError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'NOT_ENROLLED' | 'NOT_GRADABLE' | 'REASON_REQUIRED') { super(code); }
}
/** Vigesimal scale (0–20) kept in hundredths; agreed rules: grades with 2 decimals half-up, final average integer half-up, pass ≥ 11. */
export const SCALE_MAX_CENTS = 2000;
export const PASSING_GRADE = 11;
export type GradeOrigin = 'AUTOMATIC' | 'RUBRIC';

/** Half-up rounding of numerator/denominator for non-negative integers, without floating point error. */
export function roundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 0 || denominator <= 0) throw new GradingError('INVALID_INPUT');
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}
function centsOf(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new GradingError('INVALID_INPUT');
  const cents = Math.round(value * 100);
  if (Math.abs(cents - value * 100) > 1e-6 || cents < 0 || cents > max) throw new GradingError('INVALID_INPUT');
  return cents;
}

// ---------------- Strategy (CAR-06, fig. 3): each assessment type applies its own algorithm ----------------
export interface GradeResult { readonly scoreCents: number; readonly detail: Record<string, unknown> }
export interface GradingStrategy<I> { readonly origin: GradeOrigin; grade(input: I): GradeResult }

export interface AutomaticInput {
  questions: readonly { questionId: string; pointsCents: number; correctOptionIds: readonly string[] }[];
  answers: Readonly<Record<string, readonly string[]>>;
}
/** Objective questions, all-or-nothing: a question scores only if the chosen set equals the correct set. */
export class AutomaticGrading implements GradingStrategy<AutomaticInput> {
  readonly origin = 'AUTOMATIC' as const;
  grade(input: AutomaticInput): GradeResult {
    const total = input.questions.reduce((sum, question) => sum + question.pointsCents, 0);
    if (!input.questions.length || total <= 0) throw new GradingError('INVALID_INPUT');
    const results = input.questions.map(question => {
      const chosen = new Set(input.answers[question.questionId] ?? []); const correct = new Set(question.correctOptionIds);
      const right = chosen.size === correct.size && [...correct].every(id => chosen.has(id));
      return { questionId: question.questionId, earnedCents: right ? question.pointsCents : 0, maxCents: question.pointsCents };
    });
    const earned = results.reduce((sum, result) => sum + result.earnedCents, 0);
    return { scoreCents: roundHalfUp(earned * SCALE_MAX_CENTS, total), detail: { earnedCents: earned, maxCents: total, questions: results } };
  }
}

export interface RubricInput {
  criteria: readonly { id: string; maxPointsCents: number }[];
  awards: readonly { criterionId: string; points: number }[];
}
/** Manual grading by rubric: every criterion receives 0..max points; the total is scaled to 0–20. */
export class RubricGrading implements GradingStrategy<RubricInput> {
  readonly origin = 'RUBRIC' as const;
  grade(input: RubricInput): GradeResult {
    const max = input.criteria.reduce((sum, criterion) => sum + criterion.maxPointsCents, 0);
    if (!input.criteria.length || max <= 0 || input.awards.length !== input.criteria.length) throw new GradingError('INVALID_INPUT');
    const awarded = new Map<string, number>();
    for (const award of input.awards) {
      const criterion = input.criteria.find(item => item.id === award.criterionId);
      if (!criterion || awarded.has(award.criterionId)) throw new GradingError('INVALID_INPUT');
      awarded.set(award.criterionId, centsOf(award.points, criterion.maxPointsCents));
    }
    const earned = [...awarded.values()].reduce((sum, value) => sum + value, 0);
    return { scoreCents: roundHalfUp(earned * SCALE_MAX_CENTS, max),
      detail: { earnedCents: earned, maxCents: max, criteria: input.criteria.map(criterion => ({ criterionId: criterion.id, pointsCents: awarded.get(criterion.id)!, maxCents: criterion.maxPointsCents })) } };
  }
}
const strategies = { QUIZ: new AutomaticGrading(), RUBRIC: new RubricGrading() };
/** Picks the algorithm by assessment type, without conditionals in the callers (OCP). */
export function strategyFor<T extends keyof typeof strategies>(type: T): (typeof strategies)[T] { return strategies[type]; }

// ---------------- Grade: each change is a new version with a mandatory reason (audited atomically) ----------------
export interface GradeData {
  readonly id: string; readonly assessmentId: string; readonly courseId: string; readonly studentId: string; readonly scoreCents: number;
  readonly origin: GradeOrigin; readonly detail: Record<string, unknown>; readonly reason: string; readonly gradedBy: string;
  readonly gradedAt: string; readonly version: number;
}
export class Grade {
  private constructor(readonly data: GradeData) {}
  static restore(data: GradeData): Grade { return new Grade(data); }
  static first(input: Omit<GradeData, 'version' | 'reason' | 'scoreCents' | 'detail' | 'origin'>, result: GradeResult, origin: GradeOrigin, reason: string): Grade {
    return new Grade({ ...input, ...Grade.checked(result), origin, reason: reason.trim().slice(0, 1000) || 'Calificación inicial', version: 0 });
  }
  revise(result: GradeResult, origin: GradeOrigin, reason: string, gradedBy: string, gradedAt: string): Grade {
    if (!reason.trim()) throw new GradingError('REASON_REQUIRED');
    if (reason.trim().length > 1000) throw new GradingError('INVALID_INPUT');
    return new Grade({ ...this.data, ...Grade.checked(result), origin, reason: reason.trim(), gradedBy, gradedAt, version: this.data.version + 1 });
  }
  private static checked(result: GradeResult) {
    if (!Number.isInteger(result.scoreCents) || result.scoreCents < 0 || result.scoreCents > SCALE_MAX_CENTS) throw new GradingError('INVALID_INPUT');
    return { scoreCents: result.scoreCents, detail: result.detail };
  }
}

// ---------------- Weighted average (promedio ponderado) ----------------
export interface WeightedItem { readonly weightBp: number; readonly scoreCents: number | null }
export interface Average {
  /** Average over graded assessments only (2 decimals), null when nothing is graded. */
  currentCents: number | null;
  /** Σ grade × weight / 100%, ungraded counting 0 (2 decimals). */
  finalCents: number;
  /** Final average rounded half-up to an integer, as reported to the student. */
  finalRounded: number;
  approved: boolean;
  gradedWeightBp: number;
  totalWeightBp: number;
  /** All weights sum 100% and every assessment is graded. */
  complete: boolean;
}
export function weightedAverage(items: readonly WeightedItem[]): Average {
  for (const item of items) if (!Number.isInteger(item.weightBp) || item.weightBp < 0 || (item.scoreCents !== null && (item.scoreCents < 0 || item.scoreCents > SCALE_MAX_CENTS)))
    throw new GradingError('INVALID_INPUT');
  const graded = items.filter(item => item.scoreCents !== null);
  const gradedWeightBp = graded.reduce((sum, item) => sum + item.weightBp, 0);
  const totalWeightBp = items.reduce((sum, item) => sum + item.weightBp, 0);
  const weighted = graded.reduce((sum, item) => sum + item.scoreCents! * item.weightBp, 0);
  const finalCents = roundHalfUp(weighted, 10000);
  const finalRounded = roundHalfUp(finalCents, 100);
  return { currentCents: gradedWeightBp ? roundHalfUp(weighted, gradedWeightBp) : null, finalCents, finalRounded, approved: finalRounded >= PASSING_GRADE,
    gradedWeightBp, totalWeightBp, complete: totalWeightBp === 10000 && graded.length === items.length };
}
