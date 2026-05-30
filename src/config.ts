import dotenv from 'dotenv';

dotenv.config();

export type Role = 'all' | 'api' | 'worker';

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric environment variable ${name}: ${raw}`);
  }
  return value;
}

function role(): Role {
  const raw = (process.env.ROLE ?? 'all').toLowerCase();
  if (raw === 'all' || raw === 'api' || raw === 'worker') return raw;
  throw new Error(`Invalid ROLE: ${raw}`);
}

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/reconciler',
  port: int('PORT', 3000),
  role: role(),
  carrierBaseUrl: process.env.CARRIER_BASE_URL ?? 'http://localhost:4000',
  carrierPollIntervalMs: int('CARRIER_POLL_INTERVAL_MS', 300000),
  carrierPollBatchSize: int('CARRIER_POLL_BATCH_SIZE', 100),
  carrierTimeoutMs: int('CARRIER_TIMEOUT_MS', 5000),
  notificationLeadMs: int('NOTIFICATION_LEAD_MS', 86400000),
  notificationScanIntervalMs: int('NOTIFICATION_SCAN_INTERVAL_MS', 30000),
  notificationBatchSize: int('NOTIFICATION_BATCH_SIZE', 100),
};
