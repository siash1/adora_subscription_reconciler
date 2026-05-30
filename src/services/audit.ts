import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { CanonicalEntitlement } from '../domain/types';

interface EntitlementSnapshot {
  active: boolean;
  source: string;
  expiresAt: string | null;
  reason: string | null;
}

interface PreviousRow {
  active: boolean;
  source: string;
  expires_at: Date | null;
  reason: string | null;
}

export interface TimelineEntry {
  at: string;
  eventId: string | null;
  source: string;
  previous: EntitlementSnapshot | null;
  next: EntitlementSnapshot;
}

function fromRow(row: PreviousRow | undefined): EntitlementSnapshot | null {
  if (!row) return null;
  return {
    active: row.active,
    source: row.source,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    reason: row.reason ?? null,
  };
}

function fromCanonical(next: CanonicalEntitlement): EntitlementSnapshot {
  return {
    active: next.active,
    source: next.source,
    expiresAt: next.expiresAtMs === null ? null : new Date(next.expiresAtMs).toISOString(),
    reason: next.reason,
  };
}

export async function writeAudit(
  client: PoolClient,
  userId: string,
  eventId: string | null,
  previous: PreviousRow | undefined,
  next: CanonicalEntitlement,
  at: Date,
): Promise<void> {
  await client.query(
    `INSERT INTO entitlement_audit (user_id, event_id, source, previous_state, next_state, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, eventId, next.source, fromRow(previous), fromCanonical(next), at],
  );
}

export async function getTimeline(userId: string): Promise<TimelineEntry[]> {
  const { rows } = await pool.query(
    `SELECT event_id, source, previous_state, next_state, created_at
     FROM entitlement_audit
     WHERE user_id = $1
     ORDER BY created_at, id`,
    [userId],
  );
  return rows.map((r) => ({
    at: r.created_at.toISOString(),
    eventId: r.event_id,
    source: r.source,
    previous: r.previous_state,
    next: r.next_state,
  }));
}
