import { PoolClient } from 'pg';
import { pool, withTransaction } from '../db/pool';
import { config } from '../config';

const TYPE = 'PREMIUM_EXPIRES_SOON';

export async function scheduleExpiryNotification(
  client: PoolClient,
  userId: string,
  expiresAtMs: number,
  nowMs: number,
): Promise<void> {
  if (expiresAtMs <= nowMs) return;
  if (expiresAtMs - nowMs > config.notificationLeadMs) return;
  const targetExpiresAt = new Date(expiresAtMs);
  const scheduledFor = new Date(Math.max(nowMs, expiresAtMs - config.notificationLeadMs));
  await client.query(
    `INSERT INTO notifications (user_id, type, target_expires_at, scheduled_for)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, type, target_expires_at) DO NOTHING`,
    [userId, TYPE, targetExpiresAt, scheduledFor],
  );
}

export async function scanForExpiringEntitlements(nowMs: number): Promise<number> {
  const now = new Date(nowMs);
  const horizon = new Date(nowMs + config.notificationLeadMs);
  const leadSeconds = config.notificationLeadMs / 1000;
  const result = await pool.query(
    `INSERT INTO notifications (user_id, type, target_expires_at, scheduled_for)
     SELECT user_id, $1, expires_at,
            GREATEST($2::timestamptz, expires_at - make_interval(secs => $3::double precision))
     FROM user_entitlements
     WHERE active = true
       AND expires_at IS NOT NULL
       AND expires_at > $2
       AND expires_at <= $4
     ON CONFLICT (user_id, type, target_expires_at) DO NOTHING`,
    [TYPE, now, leadSeconds, horizon],
  );
  return result.rowCount ?? 0;
}

export async function sendDueNotifications(nowMs: number, batchSize = config.notificationBatchSize): Promise<number> {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT n.id FROM notifications n
       JOIN user_entitlements e ON e.user_id = n.user_id
       WHERE n.sent_at IS NULL
         AND n.scheduled_for <= $1
         AND e.active = true
         AND e.expires_at = n.target_expires_at
       ORDER BY n.scheduled_for
       FOR UPDATE OF n SKIP LOCKED
       LIMIT $2`,
      [new Date(nowMs), batchSize],
    );
    if (rows.length === 0) return 0;
    const ids = rows.map((r) => r.id);
    await client.query('UPDATE notifications SET sent_at = $1 WHERE id = ANY($2::bigint[])', [
      new Date(nowMs),
      ids,
    ]);
    return ids.length;
  });
}

export async function runNotificationCycle(nowMs = Date.now()): Promise<{ scheduled: number; sent: number }> {
  const scheduled = await scanForExpiringEntitlements(nowMs);
  const sent = await sendDueNotifications(nowMs);
  return { scheduled, sent };
}
