import { ApiError } from './api';

export type QuestionType = 'SINGLE' | 'MULTIPLE' | 'TRUE_FALSE';
export interface QuestionOption { id: string; text: string; correct: boolean }
export interface Question { id: string; bankId: string; type: QuestionType; statement: string; pointsCents: number; options: QuestionOption[]; active: boolean; version: number }
export interface Bank { id: string; courseId: string; name: string; questions: Question[] }
export interface Criterion { id: string; description: string; maxPointsCents: number }
export interface Assessment {
  id: string; courseId: string; title: string; instructions: string; type: 'QUIZ' | 'RUBRIC'; weightBp: number; dueAt: string;
  durationMinutes: number | null; questionCount: number | null; bankId?: string | null; criteria: Criterion[];
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED'; revision?: number; publishedAt: string | null;
}
export interface Average { current: number | null; final: number; finalRounded: number; approved: boolean; gradedWeight: number; totalWeight: number; complete: boolean }
export interface GradeView { assessmentId: string; score: number; origin: string; detail: { criteria?: { criterionId: string; pointsCents: number }[] }; reason?: string; gradedAt: string; version: number }
export interface GradableView { id: string; title: string; type: 'QUIZ' | 'RUBRIC'; weight: number; status: string; dueAt: string; criteria: { id: string; description: string; maxPoints: number }[] }
export interface Gradebook {
  courseId: string; scale: { max: number; passing: number }; canGrade: boolean; assessments: GradableView[];
  students: { studentId: string; displayName: string; grades: GradeView[]; average: Average }[];
}
export interface MyGrades { courseId: string; scale: { max: number; passing: number }; assessments: GradableView[]; grades: GradeView[]; average: Average }
export interface AuditEntry {
  id: string; entity: string; entityId: string; action: string; actorId: string; actorName: string; occurredAt: string; hash: string;
  changes: { field: string; before: unknown; after: unknown }[];
}

export const assessmentStates = { DRAFT: 'Borrador', PUBLISHED: 'Publicada', CLOSED: 'Cerrada' };
export const questionTypes: Record<QuestionType, string> = { SINGLE: 'Opción única', MULTIPLE: 'Opción múltiple', TRUE_FALSE: 'Verdadero / Falso' };
export const points = (cents: number) => (cents / 100).toLocaleString('es-PE', { maximumFractionDigits: 2 });

const messages: Record<string, string> = {
  INVALID_INPUT: 'Revisa los datos ingresados.', FORBIDDEN: 'No tienes permiso para esta acción.', NOT_FOUND: 'El recurso no existe.',
  CONFLICT: 'Los datos cambiaron. Recarga antes de guardar.', INVALID_STATE: 'El estado de la evaluación no permite este cambio.',
  WEIGHT_EXCEEDED: 'La suma de pesos del curso superaría el 100 %.', INSUFFICIENT_QUESTIONS: 'El banco no tiene suficientes preguntas activas.',
  COURSE_NOT_PUBLISHED: 'Solo puedes publicar evaluaciones de un curso publicado.', NOT_ENROLLED: 'El estudiante no está inscrito en el curso.',
  NOT_GRADABLE: 'Esta evaluación aún no acepta calificaciones manuales.', REASON_REQUIRED: 'Indica el motivo del cambio de nota.',
};
/** Calls /api/{assessments|grading|audit}; error codes are translated, never trusted for authorization. */
export async function evaluationApi<T>(path: string, token: string, body?: unknown, method?: 'PATCH' | 'DELETE'): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch { throw new Error('No se pudo conectar con el servicio de evaluaciones.'); }
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { code?: string };
    throw new ApiError(response.status, messages[result.code ?? ''] ?? (response.status === 401 ? 'La sesión ya no está vigente.' : 'No se pudo completar la operación.'));
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
