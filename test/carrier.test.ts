import { beforeEach, expect, it } from 'vitest';
import { resetDb, storeEvent, DAY, T0 } from './helpers';
import { applyCarrierResult, enrollCarrier, runCarrierPollCycle } from '../src/services/carrier';
import { ingestStoreEvent } from '../src/services/store';
import { getEntitlement } from '../src/services/entitlement';
import { CarrierClient, CarrierStatus } from '../src/services/carrierClient';
import { pool } from '../src/db/pool';

beforeEach(resetDb);

function countingClient(calls: Map<string, number>): CarrierClient {
  return {
    async fetchPlan(userId: string): Promise<CarrierStatus> {
      calls.set(userId, (calls.get(userId) ?? 0) + 1);
      return 'active';
    },
  };
}

it('revokes carrier entitlement when a poll returns inactive', async () => {
  const now = T0 + DAY;
  await enrollCarrier('u_in');
  await applyCarrierResult('u_in', 'active', now);

  const inactiveClient: CarrierClient = { async fetchPlan() { return 'inactive'; } };
  await runCarrierPollCycle({ client: inactiveClient, intervalMs: 300000, batchSize: 10, nowMs: now });

  const view = await getEntitlement('u_in');
  expect(view.active).toBe(false);
});

it('leaves carrier state unchanged on an api error', async () => {
  const now = T0 + DAY;
  await enrollCarrier('u_err');
  await applyCarrierResult('u_err', 'active', now);
  await applyCarrierResult('u_err', 'api_error', now);

  const { rows } = await pool.query('SELECT status, last_error FROM carrier_state WHERE user_id = $1', ['u_err']);
  expect(rows[0].status).toBe('active');
  expect(rows[0].last_error).toBe('api_error');

  const view = await getEntitlement('u_err');
  expect(view.active).toBe(true);
  expect(view.source).toBe('CARRIER');
});

it('does not poll the same user twice across concurrent workers and batches', async () => {
  const now = T0 + DAY;
  const ids = Array.from({ length: 50 }, (_, i) => `u_c${i}`);
  for (const id of ids) await enrollCarrier(id);

  const calls = new Map<string, number>();
  const client = countingClient(calls);

  await Promise.all([
    runCarrierPollCycle({ client, intervalMs: 300000, batchSize: 5, nowMs: now }),
    runCarrierPollCycle({ client, intervalMs: 300000, batchSize: 5, nowMs: now }),
    runCarrierPollCycle({ client, intervalMs: 300000, batchSize: 5, nowMs: now }),
  ]);

  expect(calls.size).toBe(ids.length);
  for (const id of ids) expect(calls.get(id)).toBe(1);
});

it('does not re-poll a user within the interval on a later cycle', async () => {
  const now = T0 + DAY;
  await enrollCarrier('u_once');
  const calls = new Map<string, number>();
  const client = countingClient(calls);

  await Promise.all([
    runCarrierPollCycle({ client, intervalMs: 300000, batchSize: 5, nowMs: now }),
    runCarrierPollCycle({ client, intervalMs: 300000, batchSize: 5, nowMs: now }),
  ]);
  expect(calls.get('u_once')).toBe(1);

  await runCarrierPollCycle({ client, intervalMs: 300000, batchSize: 5, nowMs: now });
  expect(calls.get('u_once')).toBe(1);
});

it('does not grant premium for an enrolled but never-polled user', async () => {
  await enrollCarrier('u_unknown');
  const view = await getEntitlement('u_unknown');
  expect(view.active).toBe(false);
  expect(view.source).toBe('NONE');
});

it('does not fabricate carrier state for a poll result on a non-enrolled user', async () => {
  await applyCarrierResult('u_noenroll', 'active', T0 + DAY);
  const view = await getEntitlement('u_noenroll');
  expect(view.active).toBe(false);
  expect(view.source).toBe('NONE');

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM carrier_state WHERE user_id = $1', ['u_noenroll']);
  expect(rows[0].n).toBe(0);
});

it('converges a concurrent carrier poll and store ingest for the same user', async () => {
  const now = T0 + DAY;
  await enrollCarrier('u_mix');
  const activeClient: CarrierClient = { async fetchPlan() { return 'active'; } };

  await Promise.all([
    runCarrierPollCycle({ client: activeClient, intervalMs: 300000, batchSize: 10, nowMs: now }),
    ingestStoreEvent(storeEvent('r', 'u_mix', 'RENEWAL', T0), now),
  ]);

  const view = await getEntitlement('u_mix');
  expect(view.active).toBe(true);
  expect(view.source).toBe('CARRIER');

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM store_events WHERE user_id = $1', ['u_mix']);
  expect(rows[0].n).toBe(1);
});
