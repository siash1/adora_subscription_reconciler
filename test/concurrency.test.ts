import { beforeEach, expect, it } from 'vitest';
import { resetDb, storeEvent, DAY, MONTH, T0 } from './helpers';
import { ingestStoreEvent } from '../src/services/store';
import { getEntitlement } from '../src/services/entitlement';
import { pool } from '../src/db/pool';

beforeEach(resetDb);

it('converges two concurrent distinct store webhooks for the same user', async () => {
  const now = T0 + 10 * DAY;
  await Promise.all([
    ingestStoreEvent(storeEvent('p', 'u_cc', 'INITIAL_PURCHASE', T0), now),
    ingestStoreEvent(storeEvent('r', 'u_cc', 'RENEWAL', T0 + MONTH), now),
  ]);

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM store_events WHERE user_id = $1', ['u_cc']);
  expect(rows[0].n).toBe(2);

  const view = await getEntitlement('u_cc');
  expect(view.active).toBe(true);
  expect(view.source).toBe('STORE');
  expect(view.expiresAt).toBe(new Date(T0 + 2 * MONTH).toISOString());
});

it('inserts exactly one row when the same event is delivered concurrently', async () => {
  const now = T0 + DAY;
  const event = storeEvent('dup', 'u_dupc', 'INITIAL_PURCHASE', T0);

  const [a, b] = await Promise.all([ingestStoreEvent(event, now), ingestStoreEvent(event, now)]);

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM store_events WHERE user_id = $1', ['u_dupc']);
  expect(rows[0].n).toBe(1);
  expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
});
