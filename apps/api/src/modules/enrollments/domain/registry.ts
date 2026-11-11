/** Nightly synchronization with the Academic Registry (CAR-09, CU-12). Pure rules, no I/O. */
export const REGISTRY_TIME_ZONE = 'America/Lima';
export const NIGHTLY_HOUR = 2;
/** "Up to 3 retries" (EAC-06): one initial call plus at most three retries per section. */
export const MAX_RETRIES = 3;
/** A run still RUNNING after this long belongs to a crashed replica and no longer blocks new runs. */
export const STALE_RUN_MS = 30 * 60_000;

export class RegistryUnavailableError extends Error {
  constructor(readonly reason: string) { super(reason); }
}
export interface RegistrySectionKey { readonly code: string; readonly period: string }
export interface SyncTotals { sections: number; added: number; removed: number; unknown: number; skipped: number; retries: number }
export type SyncStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED';

function limaParts(instant: Date): { date: string; hour: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: REGISTRY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(instant).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
/**
 * The nightly slot of the local day in Lima. It is due from 02:00 local time on; the slot key is unique per day so
 * exactly one replica runs it (the first one that claims the slot), even if the process was down at 02:00.
 */
export function nightlyWindow(nowIso: string, hour = NIGHTLY_HOUR): { slot: string; due: boolean } {
  const { date, hour: current } = limaParts(new Date(nowIso));
  return { slot: `NIGHTLY:${date}`, due: current >= hour };
}
/** Exponential backoff before retry number `retry` (1-based): base, 2·base, 4·base. */
export function backoffMs(retry: number, baseMs: number): number {
  if (!Number.isInteger(retry) || retry < 1) throw new RangeError('retry');
  return baseMs * 2 ** (retry - 1);
}
export function normalizeSection(code: string, period: string): RegistrySectionKey {
  const key = { code: code.trim().toUpperCase(), period: period.trim().toUpperCase() };
  if (!key.code || !key.period || key.code.length > 40 || key.period.length > 40) throw new RangeError('section');
  return key;
}
