/** Analytics owns its projections (connection time, risk rules) and exposes them only over HTTP to staff in this phase. */
export const RISK_LEVELS = ['BAJO', 'MEDIO', 'ALTO'] as const;
export const HEARTBEAT_SECONDS = 60;
