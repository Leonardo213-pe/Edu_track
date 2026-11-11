export const roles = { STUDENT: 'Estudiante', TEACHER: 'Docente', INSTRUCTIONAL_DESIGNER: 'Diseñador instruccional', ADMIN: 'Administrador' };
export type Role = keyof typeof roles;
export interface Profile { id: string; email: string; displayName: string; role: Role; createdAt: string; active: boolean; version: number; permissions: string[] }
export interface Session { accessToken: string; expiresIn: number; user: Profile }
export class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export async function api<T>(path: string, token?: string, body?: unknown, method?: 'PATCH'): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/identity/${path}`, { method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch { throw new Error('No se pudo conectar. Comprueba tu conexión e inténtalo de nuevo.'); }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { code?: string };
    const codes: Record<string, string> = { LAST_ADMIN: 'Debe quedar al menos un administrador activo.', CONFLICT: 'Los datos cambiaron. Recarga la lista antes de guardar.', INVALID_RESET: 'El enlace es inválido o venció. Solicita uno nuevo.', PASSWORD_MISMATCH: 'La contraseña actual no es correcta.' };
    const messages: Record<number, string> = { 400: 'Revisa los datos ingresados.', 401: 'Credenciales inválidas o sesión vencida.',
      403: 'Tu rol no permite esta acción.', 409: 'Este correo ya está registrado.', 429: 'Demasiados intentos. Espera un minuto.' };
    throw new ApiError(response.status, codes[payload.code ?? ''] ?? messages[response.status] ?? 'El servicio no está disponible. Inténtalo más tarde.');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
