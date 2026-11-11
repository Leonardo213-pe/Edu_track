export type AssessmentErrorCode = 'INVALID_INPUT' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID_STATE' | 'WEIGHT_EXCEEDED' | 'INSUFFICIENT_QUESTIONS' | 'COURSE_NOT_PUBLISHED';
export class AssessmentError extends Error {
  constructor(readonly code: AssessmentErrorCode) { super(code); }
}
export type QuestionType = 'SINGLE' | 'MULTIPLE' | 'TRUE_FALSE';
export const QUESTION_TYPES: readonly QuestionType[] = ['SINGLE', 'MULTIPLE', 'TRUE_FALSE'];
export interface QuestionOption { readonly id: string; readonly text: string; readonly correct: boolean }
export interface QuestionData {
  readonly id: string; readonly bankId: string; readonly type: QuestionType; readonly statement: string; readonly pointsCents: number;
  readonly options: readonly QuestionOption[]; readonly active: boolean; readonly version: number; readonly createdAt: string;
}
export interface QuestionInput { type: QuestionType; statement: string; points: number; options: { id?: string; text: string; correct: boolean }[]; active?: boolean }

export function text(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.trim().length > max) throw new AssessmentError('INVALID_INPUT');
  return value.trim();
}
/** Converts a decimal with at most two decimals into integer hundredths, avoiding floating point accumulation. */
export function toCents(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new AssessmentError('INVALID_INPUT');
  const cents = Math.round(value * 100);
  if (Math.abs(cents - value * 100) > 1e-6 || cents < min || cents > max) throw new AssessmentError('INVALID_INPUT');
  return cents;
}

/** Bank question with the rules of its type; the correct options never leave the server towards students. */
export class Question {
  private constructor(readonly data: QuestionData) {}
  static restore(data: QuestionData): Question { return new Question(data); }
  static create(id: string, bankId: string, input: QuestionInput, newId: () => string, now: string): Question {
    return new Question(Question.validate({ id, bankId, version: 0, createdAt: now }, input, newId));
  }
  revise(input: QuestionInput, newId: () => string): Question {
    return new Question(Question.validate({ id: this.data.id, bankId: this.data.bankId, version: this.data.version + 1, createdAt: this.data.createdAt }, input, newId));
  }
  private static validate(base: Pick<QuestionData, 'id' | 'bankId' | 'version' | 'createdAt'>, input: QuestionInput, newId: () => string): QuestionData {
    if (!(QUESTION_TYPES as readonly string[]).includes(input.type) || !Array.isArray(input.options)) throw new AssessmentError('INVALID_INPUT');
    const options = input.options.map(option => ({ id: option.id && /^[\w-]{1,40}$/.test(option.id) ? option.id : newId(), text: text(option.text, 1000), correct: option.correct === true }));
    const correct = options.filter(option => option.correct).length;
    const distinct = new Set(options.map(option => option.text.toLowerCase())).size === options.length && new Set(options.map(option => option.id)).size === options.length;
    if (!distinct || options.length < 2 || options.length > 10) throw new AssessmentError('INVALID_INPUT');
    if ((input.type === 'SINGLE' || input.type === 'TRUE_FALSE') && correct !== 1) throw new AssessmentError('INVALID_INPUT');
    if (input.type === 'MULTIPLE' && correct < 1) throw new AssessmentError('INVALID_INPUT');
    if (input.type === 'TRUE_FALSE' && (options.length !== 2 || options.map(option => option.text).sort().join('|') !== 'Falso|Verdadero')) throw new AssessmentError('INVALID_INPUT');
    return { ...base, type: input.type, statement: text(input.statement, 5000), pointsCents: toCents(input.points, 1, 10000), options, active: input.active ?? true };
  }
}
