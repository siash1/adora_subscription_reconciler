import { pool, withTransaction } from '../db/pool';
import { config } from '../config';
import { reconcileUserTx } from './reconciler';
import { CarrierClient, CarrierStatus, httpCarrierClient } from './carrierClient';

export async function enrollCarrier(userId: string): Promise<void> {
  await pool.query(
    `INSERT INTO carrier_state (user_id, status) VALUES ($1, 'unknown')
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
}

export async function claimDueCarrierUsers(intervalMs: number, batchSize: number): Promise<string[]> {
  const { rows } = await pool.query(
    `UPDATE carrier_state c
     SET last_polled_at = now()
     FROM (
       SELECT user_id FROM carrier_state
       WHERE last_polled_at IS NULL OR last_polled_at < now() - make_interval(secs => $1::double precision)
       ORDER BY last_polled_at NULLS FIRST
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     ) due
     WHERE c.user_id = due.user_id
     RETURNING c.user_id`,
    [intervalMs / 1000, batchSize],
  );
  return rows.map((r) => r.user_id);
}

export async function applyCarrierResult(userId: string, status: CarrierStatus, nowMs = Date.now()): Promise<void> {
  await withTransaction(async (client) => {
    if (status === 'api_error') {
      await client.query(
        `UPDATE carrier_state SET last_error = 'api_error', updated_at = now() WHERE user_id = $1`,
        [userId],
      );
      return;
    }
    await client.query(
      `UPDATE carrier_state SET status = $2, last_error = NULL, updated_at = now() WHERE user_id = $1`,
      [userId, status],
    );
    await reconcileUserTx(client, userId, { nowMs });
  });
}

export interface CarrierPollOptions {
  client?: CarrierClient;
  intervalMs?: number;
  batchSize?: number;
  nowMs?: number;
}

export async function runCarrierPollCycle(options: CarrierPollOptions = {}): Promise<number> {
  const client = options.client ?? httpCarrierClient;
  const intervalMs = options.intervalMs ?? config.carrierPollIntervalMs;
  const batchSize = options.batchSize ?? config.carrierPollBatchSize;
  let processed = 0;
  for (;;) {
    const users = await claimDueCarrierUsers(intervalMs, batchSize);
    if (users.length === 0) break;
    for (const userId of users) {
      const status = await client.fetchPlan(userId);
      await applyCarrierResult(userId, status, options.nowMs ?? Date.now());
      processed += 1;
    }
  }
  return processed;
}
