import { ApiError } from './api';
export interface MaterialVersion { id: string; number: number; kind: 'FILE' | 'LINK' | 'VIDEO'; filename: string | null; mimeType: string | null; size: number | null; sha256: string | null; url: string | null; createdAt: string }
export interface CourseMaterial { id: string; title: string; position: number; versions: MaterialVersion[] }
export interface CourseSession { id: string; title: string; description: string; durationMinutes: number; position: number; materials: CourseMaterial[] }
export interface CourseUnit { id: string; title: string; position: number; sessions: CourseSession[] }
export interface CourseView {
  id: string; code: string; name: string; description: string; period: string; teacherId: string; teacherName?: string; syllabus: string;
  status: 'BORRADOR' | 'EN_REVISION' | 'PUBLICADO' | 'ARCHIVADO'; revision: number; units: CourseUnit[]; durationMinutes: number; removable?: boolean;
  reviews: { id: string; decision: string; observations: string; createdAt: string; actorId: string; revision: number }[];
  progress?: { percentage: number; total: number; completed: number }; completedVersions?: string[];
}
export interface HistoryEntry { id: string; revision: number; actorId: string; actorName: string; action: string; detail: Record<string, unknown>; createdAt: string }
export interface Roster {
  courseId: string; students: { id: string; displayName: string; email: string | null }[];
  runs: { id: string; added: number; removed: number; total: number; occurredAt: string }[];
  added?: number; removed?: number; unchanged?: number; total?: number;
}
export const courseStates = { BORRADOR: 'Borrador', EN_REVISION: 'En revisión', PUBLICADO: 'Publicado', ARCHIVADO: 'Archivado' };
export function formatMinutes(total: number): string {
  if (!total) return 'Sin duración registrada';
  const hours = Math.floor(total / 60), minutes = total % 60;
  return [hours ? `${hours} h` : '', minutes ? `${minutes} min` : ''].filter(Boolean).join(' ');
}
const messages: Record<string, string> = { INVALID_INPUT: 'Revisa los datos del curso.', FORBIDDEN: 'No tienes permiso sobre este curso.', NOT_FOUND: 'El contenido no está disponible.',
  CONFLICT: 'El curso cambió. Recarga antes de guardar.', INVALID_STATE: 'El estado del curso no permite esta operación.', INCOMPLETE_COURSE: 'Completa el sílabo y agrega al menos una sesión con material en cada unidad.',
  FILE_REJECTED: 'Archivo rechazado. Revisa formato, contenido y tamaño máximo de 25 MB.' };
async function request<T>(url: string, token: string, body?: unknown, method?: 'PATCH' | 'DELETE'): Promise<T> {
  const multipart = body instanceof FormData; let response: Response;
  try {
    response = await fetch(url, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: {
      Authorization: `Bearer ${token}`, ...(body === undefined || multipart ? {} : { 'Content-Type': 'application/json' }),
    }, ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }) });
  } catch { throw new Error('No se pudo conectar con el servicio académico.'); }
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { code?: string; unknown?: string[] };
    if (result.code === 'UNKNOWN_STUDENTS') throw new ApiError(400, `No se aplicó la lista. Estas cuentas no son estudiantes activos: ${result.unknown?.join(', ')}`);
    throw new ApiError(response.status, messages[result.code ?? ''] ?? (response.status === 413 ? 'El archivo supera 25 MB.' : response.status === 401 ? 'La sesión ya no está vigente.' : response.status === 429 ? 'Demasiadas solicitudes. Espera un minuto.' : 'No se pudo completar la operación.'));
  }
  return response.json() as Promise<T>;
}
export function courseApi<T>(path: string, token: string, body?: unknown, method?: 'PATCH' | 'DELETE'): Promise<T> { return request<T>(`/api/courses${path}`, token, body, method); }
export function enrollmentApi<T>(path: string, token: string, body?: unknown): Promise<T> { return request<T>(`/api/enrollments${path}`, token, body); }
export async function openCourseFile(path: string, token: string, version: MaterialVersion, preview: boolean): Promise<string | null> {
  const response = await fetch(`/api/courses${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new ApiError(response.status, 'No se pudo acceder al archivo autorizado.');
  const blob = await response.blob(); const url = URL.createObjectURL(blob);
  if (preview) return url;
  const link = document.createElement('a'); link.href = url; link.download = version.filename ?? 'material'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); return null;
}
