export const roles = { STUDENT: 'Estudiante', TEACHER: 'Docente', INSTRUCTIONAL_DESIGNER: 'Diseñador instruccional', ADMIN: 'Administrador' };
export type Role = keyof typeof roles;
export interface Profile { id: string; email: string; displayName: string; role: Role; createdAt: string }
export interface Session { accessToken: string; expiresIn: number; user: Profile }
export class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export async function api<T>(path: string, token?: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/identity/${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch { throw new Error('No se pudo conectar. Comprueba tu conexión e inténtalo de nuevo.'); }
  if (!response.ok) {
    const messages: Record<number, string> = { 400: 'Revisa los datos ingresados.', 401: 'Credenciales inválidas o sesión vencida.',
      403: 'Tu rol no permite esta acción.', 409: 'Este correo ya está registrado.', 429: 'Demasiados intentos. Espera un minuto.' };
    throw new ApiError(response.status, messages[response.status] ?? 'El servicio no está disponible. Inténtalo más tarde.');
  }
  return response.json() as Promise<T>;
}
