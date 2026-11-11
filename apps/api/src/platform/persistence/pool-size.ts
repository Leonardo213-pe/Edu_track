/**
 * Technical cap for every module's PostgreSQL pool. Each adapter keeps its own default size; DB_POOL_MAX lowers all of
 * them at once for databases with few connections (e.g. a free managed PostgreSQL). Unset = adapter defaults.
 */
export function capPool(adapterDefault: number, env: NodeJS.ProcessEnv = process.env): number {
  const cap = Number(env.DB_POOL_MAX);
  return Number.isInteger(cap) && cap > 0 ? Math.min(adapterDefault, cap) : adapterDefault;
}
