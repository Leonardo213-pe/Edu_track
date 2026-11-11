import type { AcademicRegistry, RegistryHealth, RegistryLookup } from '../../application/ports';
import { RegistryUnavailableError, type RegistrySectionKey } from '../../domain/registry';

export interface RegistryHttpConfig { readonly url?: string; readonly apiKey?: string; readonly timeoutMs?: number }
/**
 * REST adapter to the Academic Registry (CAR-09). The institutional contract is not available, so in Compose it targets
 * the SIMULATED registry service (infra/registry). Only GET requests; the LMS never writes to the registry.
 */
export class HttpAcademicRegistry implements AcademicRegistry {
  readonly configured: boolean;
  constructor(private readonly config: RegistryHttpConfig) { this.configured = !!config.url && !!config.apiKey; }
  private async call(path: string): Promise<Response> {
    if (!this.configured) throw new RegistryUnavailableError('NOT_CONFIGURED');
    try {
      return await fetch(new URL(path, this.config.url), { headers: { 'X-Registry-Key': this.config.apiKey!, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 5000) });
    } catch (error) {
      throw new RegistryUnavailableError((error as Error).name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK');
    }
  }
  async studentsOf(section: RegistrySectionKey): Promise<RegistryLookup> {
    const response = await this.call(`/api/v1/sections/${encodeURIComponent(section.code)}/${encodeURIComponent(section.period)}/students`);
    if (response.status === 404) return { found: false };
    if (!response.ok) throw new RegistryUnavailableError(`HTTP_${response.status}`);
    const body = await response.json().catch(() => null) as { students?: { email?: unknown }[] } | null;
    if (!body || !Array.isArray(body.students)) throw new RegistryUnavailableError('INVALID_RESPONSE');
    return { found: true, emails: body.students.map(student => student.email).filter((email): email is string => typeof email === 'string') };
  }
  async health(): Promise<RegistryHealth> {
    const checkedAt = new Date().toISOString();
    if (!this.configured) return { configured: false, reachable: false, simulated: false, mode: 'NOT_CONFIGURED', latencyMs: null, checkedAt };
    const started = performance.now();
    try {
      const response = await this.call('/health');
      const body = await response.json().catch(() => ({})) as { mode?: unknown; simulated?: unknown };
      return { configured: true, reachable: response.ok, simulated: body.simulated === true, mode: typeof body.mode === 'string' ? body.mode.slice(0, 20) : 'UNKNOWN',
        latencyMs: Math.round(performance.now() - started), checkedAt };
    } catch (error) {
      return { configured: true, reachable: false, simulated: false, mode: (error as RegistryUnavailableError).reason ?? 'NETWORK', latencyMs: null, checkedAt };
    }
  }
}
