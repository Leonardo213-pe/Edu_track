export class AnalyticsError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'FORBIDDEN' | 'NOT_FOUND') { super(code); }
}
/** Configurable thresholds per course (CAR-08 "reglas de riesgo configurables"; no machine learning, by scope). */
export interface RiskRules { readonly minProgress: number; readonly minAverageCents: number; readonly maxInactiveDays: number; readonly maxMissed: number }
export const DEFAULT_RULES: RiskRules = { minProgress: 50, minAverageCents: 1100, maxInactiveDays: 7, maxMissed: 2 };
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new AnalyticsError('INVALID_INPUT');
  return value;
}
export function validateRules(input: { minProgress: unknown; minAverage: unknown; maxInactiveDays: unknown; maxMissed: unknown }): RiskRules {
  const average = typeof input.minAverage === 'number' ? Math.round(input.minAverage * 100) : NaN;
  if (typeof input.minAverage !== 'number' || Math.abs(average - input.minAverage * 100) > 1e-6) throw new AnalyticsError('INVALID_INPUT');
  return { minProgress: integer(input.minProgress, 0, 100), minAverageCents: integer(average, 0, 2000), maxInactiveDays: integer(input.maxInactiveDays, 1, 365), maxMissed: integer(input.maxMissed, 1, 100) };
}

export interface StudentSignals {
  /** Progress on current course materials (0-100). */
  readonly progress: number;
  /** Average of graded assessments (0-2000 hundredths), null when nothing is graded yet. */
  readonly averageCents: number | null;
  /** Whole days since the last recorded activity; null when the student never connected. */
  readonly inactiveDays: number | null;
  /** Assessments already past their due date without a grade. */
  readonly missed: number;
}
export type RiskLevel = 'BAJO' | 'MEDIO' | 'ALTO';
export interface RiskAssessment { readonly level: RiskLevel; readonly reasons: readonly string[] }

/** Each triggered rule is a reason: none → BAJO, one → MEDIO, two or more → ALTO. Explainable by construction. */
export function assessRisk(signals: StudentSignals, rules: RiskRules): RiskAssessment {
  const reasons: string[] = [];
  if (signals.progress < rules.minProgress) reasons.push(`Avance de contenidos ${signals.progress}% (mínimo ${rules.minProgress}%)`);
  if (signals.averageCents !== null && signals.averageCents < rules.minAverageCents)
    reasons.push(`Promedio ${(signals.averageCents / 100).toFixed(2)} (mínimo ${(rules.minAverageCents / 100).toFixed(2)})`);
  if (signals.inactiveDays === null) reasons.push('Sin actividad registrada en el curso');
  else if (signals.inactiveDays > rules.maxInactiveDays) reasons.push(`${signals.inactiveDays} días sin actividad (máximo ${rules.maxInactiveDays})`);
  if (signals.missed >= rules.maxMissed) reasons.push(`${signals.missed} evaluaciones vencidas sin calificación (límite ${rules.maxMissed})`);
  return { level: reasons.length === 0 ? 'BAJO' : reasons.length === 1 ? 'MEDIO' : 'ALTO', reasons };
}
export function daysSince(last: Date | null, now: Date): number | null {
  return last ? Math.max(0, Math.floor((now.getTime() - last.getTime()) / 86_400_000)) : null;
}
