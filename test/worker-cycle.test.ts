import { beforeEach, expect, it } from 'vitest';
import { resetDb, storeEvent, HOUR, MONTH, T0 } from './helpers';
import { ingestStoreEvent } from '../src/services/store';
import { runNotificationCycle } from '../src/services/notifications';
import { enrollCarrier, runCarrierPollCycle } from '../src/services/carrier';
import { getEntitlement } from '../src/services/entitlement';
import { CarrierClient } from '../src/services/carrierClient';
import { pool } from '../src/db/pool';

beforeEach(resetDb);

it('sends a due notification within a notification cycle', async () => {
  const now = T0 + MONTH - 12 * HOUR;
  await ingestStoreEvent(storeEvent('p', 'u_cyc', 'INITIAL_PURCHASE', T0), now);

  const { sent } = await runNotificationCycle(now);
  expect(sent).toBe(1);

  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND sent_at IS NOT NULL',
    ['u_cyc'],
  );
  expect(rows[0].n).toBe(1);
});

it('keeps state unchanged when a poll cycle hits an api error', async () => {
  const now = T0;
  await enrollCarrier('u_apierr');

  const errorClient: CarrierClient = { async fetchPlan() { return 'api_error'; } };
  const processed = await runCarrierPollCycle({ client: errorClient, intervalMs: 300000, batchSize: 10, nowMs: now });
  expect(processed).toBe(1);

  const view = await getEntitlement('u_apierr');
  expect(view.active).toBe(false);

  const { rows } = await pool.query('SELECT status, last_error FROM carrier_state WHERE user_id = $1', ['u_apierr']);
  expect(rows[0].status).toBe('unknown');
  expect(rows[0].last_error).toBe('api_error');
});
