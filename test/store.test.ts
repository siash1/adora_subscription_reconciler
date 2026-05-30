import { beforeEach, expect, it } from 'vitest';
import { resetDb, storeEvent, DAY, MONTH, T0 } from './helpers';
import { ingestStoreEvent } from '../src/services/store';
import { getEntitlement } from '../src/services/entitlement';
import { pool } from '../src/db/pool';

beforeEach(resetDb);

it('ingests a duplicate event at most once', async () => {
  const event = storeEvent('evt_dup', 'u_dup', 'INITIAL_PURCHASE', T0);
  const first = await ingestStoreEvent(event, T0 + DAY);
  const second = await ingestStoreEvent(event, T0 + DAY);

  expect(first.duplicate).toBe(false);
  expect(second.duplicate).toBe(true);
  expect(second.entitlement.active).toBe(true);

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM store_events WHERE user_id = $1', ['u_dup']);
  expect(rows[0].n).toBe(1);
});

it('keeps the first payload when a duplicate event id carries a different payload', async () => {
  await ingestStoreEvent(storeEvent('evt', 'u_conflict', 'INITIAL_PURCHASE', T0, 'premium_monthly'), T0 + DAY);
  const second = await ingestStoreEvent(storeEvent('evt', 'u_conflict', 'EXPIRATION', T0, 'premium_yearly'), T0 + DAY);

  expect(second.duplicate).toBe(true);

  const { rows } = await pool.query('SELECT type, product_id FROM store_events WHERE event_id = $1', ['evt']);
  expect(rows[0].type).toBe('INITIAL_PURCHASE');
  expect(rows[0].product_id).toBe('premium_monthly');

  const view = await getEntitlement('u_conflict');
  expect(view.active).toBe(true);
  expect(view.source).toBe('STORE');
  expect(view.expiresAt).toBe(new Date(T0 + MONTH).toISOString());
});

it('reaches the same state for out-of-order delivery', async () => {
  const now = T0 + 10 * DAY;
  await ingestStoreEvent(storeEvent('r', 'u_ooo', 'RENEWAL', T0 + MONTH), now);
  await ingestStoreEvent(storeEvent('p', 'u_ooo', 'INITIAL_PURCHASE', T0), now);

  const view = await getEntitlement('u_ooo');
  expect(view.active).toBe(true);
  expect(view.source).toBe('STORE');
  expect(view.reason).toBe('RENEWAL');
  expect(view.expiresAt).toBe(new Date(T0 + 2 * MONTH).toISOString());
});

it('applies a late-arriving event that flips state back to active', async () => {
  const now = T0 + 45 * DAY;
  await ingestStoreEvent(storeEvent('p', 'u_late', 'INITIAL_PURCHASE', T0), now);
  await ingestStoreEvent(storeEvent('e', 'u_late', 'EXPIRATION', T0 + 30 * DAY), now);

  let view = await getEntitlement('u_late');
  expect(view.active).toBe(false);

  await ingestStoreEvent(storeEvent('r', 'u_late', 'RENEWAL', T0 + 40 * DAY), now);
  view = await getEntitlement('u_late');
  expect(view.active).toBe(true);
  expect(view.expiresAt).toBe(new Date(T0 + 40 * DAY + MONTH).toISOString());
});

it('reports NONE with no reason for a cancellation-only stream', async () => {
  await ingestStoreEvent(storeEvent('c', 'u_never', 'CANCELLATION', T0), T0 + DAY);
  const view = await getEntitlement('u_never');
  expect(view.active).toBe(false);
  expect(view.source).toBe('NONE');
  expect(view.expiresAt).toBeNull();
  expect(view.reason).toBeNull();
});
