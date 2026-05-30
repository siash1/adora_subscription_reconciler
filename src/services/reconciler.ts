import { PoolClient } from 'pg';
import { withTransaction } from '../db/pool';
import { foldStoreEvents, storeContribution } from '../domain/store';
import { pickCanonical } from '../domain/reconcile';
import { CanonicalEntitlement, SourceContribution, StoreEvent } from '../domain/types';
import { scheduleExpiryNotification } from './notifications';

export interface ReconcileOptions {
  eventId?: string | null;
  nowMs?: number;
}

async function lockUser(client: PoolClient, userId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [userId]);
}

async function storeContributionFor(
  client: PoolClient,
  userId: string,
  nowMs: number,
): Promise<SourceContribution> {
  const { rows } = await client.query(
    'SELECT event_id, user_id, type, event_time_ms, product_id FROM store_events WHERE user_id = $1',
    [userId],
  );
  if (rows.length === 0) {
    return { source: 'STORE', active: false, expiresAtMs: null, reason: null };
  }
  const events: StoreEvent[] = rows.map((r) => ({
    eventId: r.event_id,
    userId: r.user_id,
    type: r.type,
    eventTimeMs: Number(r.event_time_ms),
    productId: r.product_id,
  }));
  return storeContribution(foldStoreEvents(events), nowMs);
}

async function carrierContributionFor(client: PoolClient, userId: string): Promise<SourceContribution> {
  const { rows } = await client.query('SELECT status FROM carrier_state WHERE user_id = $1', [userId]);
  const active = rows[0]?.status === 'active';
  return { source: 'CARRIER', active, expiresAtMs: null, reason: active ? 'CARRIER_ACTIVE' : null };
}

async function marketplaceContributionFor(client: PoolClient, userId: string): Promise<SourceContribution> {
  const { rows } = await client.query('SELECT status FROM marketplace_state WHERE user_id = $1', [userId]);
  const active = rows[0]?.status === 'granted';
  return { source: 'MARKETPLACE', active, expiresAtMs: null, reason: active ? 'MARKETPLACE_GRANT' : null };
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.getTime() === b.getTime();
}

export async function reconcileUserTx(
  client: PoolClient,
  userId: string,
  options: ReconcileOptions = {},
): Promise<CanonicalEntitlement> {
  const nowMs = options.nowMs ?? Date.now();
  await lockUser(client, userId);

  const contributions = [
    await storeContributionFor(client, userId, nowMs),
    await carrierContributionFor(client, userId),
    await marketplaceContributionFor(client, userId),
  ];
  const next = pickCanonical(contributions);
  const nextExpiresAt = next.expiresAtMs === null ? null : new Date(next.expiresAtMs);

  const { rows } = await client.query(
    'SELECT active, source, expires_at, reason, last_changed_at FROM user_entitlements WHERE user_id = $1',
    [userId],
  );
  const prev = rows[0];

  const changed =
    !prev ||
    prev.active !== next.active ||
    prev.source !== next.source ||
    !sameInstant(prev.expires_at, nextExpiresAt) ||
    (prev.reason ?? null) !== (next.reason ?? null);

  const now = new Date(nowMs);
  const lastChangedAt = changed ? now : prev.last_changed_at;

  await client.query(
    `INSERT INTO user_entitlements (user_id, active, source, expires_at, reason, last_changed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id) DO UPDATE SET
       active = EXCLUDED.active,
       source = EXCLUDED.source,
       expires_at = EXCLUDED.expires_at,
       reason = EXCLUDED.reason,
       last_changed_at = EXCLUDED.last_changed_at,
       updated_at = EXCLUDED.updated_at`,
    [userId, next.active, next.source, nextExpiresAt, next.reason, lastChangedAt, now],
  );

  if (next.active && next.expiresAtMs !== null) {
    await scheduleExpiryNotification(client, userId, next.expiresAtMs, nowMs);
  }

  return next;
}

export async function reconcileUser(userId: string, options: ReconcileOptions = {}): Promise<CanonicalEntitlement> {
  return withTransaction((client) => reconcileUserTx(client, userId, options));
}
