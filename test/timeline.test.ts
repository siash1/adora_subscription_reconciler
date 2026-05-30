import { AddressInfo } from 'net';
import { Server } from 'http';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { resetDb, storeEvent, DAY, HOUR, MONTH, T0 } from './helpers';
import { ingestStoreEvent } from '../src/services/store';
import { applyCarrierResult, enrollCarrier } from '../src/services/carrier';
import { grantMarketplace, revokeMarketplace } from '../src/services/marketplace';
import { getTimeline } from '../src/services/audit';
import { createApp } from '../src/app';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(resetDb);

it('records an audit entry for every real transition and reconstructs the timeline', async () => {
  const now = T0 + DAY;
  await ingestStoreEvent(storeEvent('p', 'u_tl', 'INITIAL_PURCHASE', T0), now);
  await ingestStoreEvent(storeEvent('c', 'u_tl', 'CANCELLATION', T0 + 2 * HOUR), now);
  await ingestStoreEvent(storeEvent('e', 'u_tl', 'EXPIRATION', T0 + 3 * HOUR), now);

  const entries = await getTimeline('u_tl');
  expect(entries).toHaveLength(3);

  expect(entries[0].previous).toBeNull();
  expect(entries[0].eventId).toBe('p');
  expect(entries[0].next).toMatchObject({ active: true, source: 'STORE', reason: 'INITIAL_PURCHASE' });
  expect(entries[0].next.expiresAt).toBe(new Date(T0 + MONTH).toISOString());

  expect(entries[1].eventId).toBe('c');
  expect(entries[1].previous).toMatchObject({ reason: 'INITIAL_PURCHASE' });
  expect(entries[1].next).toMatchObject({ active: true, source: 'STORE', reason: 'CANCELLATION' });

  expect(entries[2].eventId).toBe('e');
  expect(entries[2].previous).toMatchObject({ active: true, source: 'STORE', reason: 'CANCELLATION' });
  expect(entries[2].next).toMatchObject({ active: false, source: 'NONE', reason: 'EXPIRATION', expiresAt: null });
});

it('does not record an audit entry for a no-op reconcile', async () => {
  const now = T0 + DAY;
  await ingestStoreEvent(storeEvent('p', 'u_noop', 'INITIAL_PURCHASE', T0), now);
  await ingestStoreEvent(storeEvent('p', 'u_noop', 'INITIAL_PURCHASE', T0), now);

  const entries = await getTimeline('u_noop');
  expect(entries).toHaveLength(1);
});

it('records carrier-driven transitions with no triggering event id', async () => {
  const now = T0 + DAY;
  await enrollCarrier('u_carr');
  await applyCarrierResult('u_carr', 'active', now);

  const entries = await getTimeline('u_carr');
  expect(entries).toHaveLength(1);
  expect(entries[0].eventId).toBeNull();
  expect(entries[0].next).toMatchObject({ active: true, source: 'CARRIER' });
});

it('records audit entries for marketplace grant and revoke transitions', async () => {
  const now = T0 + DAY;
  await ingestStoreEvent(storeEvent('p', 'u_mkt', 'INITIAL_PURCHASE', T0), now);
  await grantMarketplace(['u_mkt'], now);
  await revokeMarketplace(['u_mkt'], now);

  const entries = await getTimeline('u_mkt');
  expect(entries.map((e) => e.next.source)).toEqual(['STORE', 'MARKETPLACE', 'STORE']);
  expect(entries[1].eventId).toBeNull();
  expect(entries[2].eventId).toBeNull();
});

it('serves the timeline over http', async () => {
  const now = T0 + DAY;
  await ingestStoreEvent(storeEvent('p', 'u_http', 'INITIAL_PURCHASE', T0), now);

  const res = await fetch(`${baseUrl}/users/u_http/timeline`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.userId).toBe('u_http');
  expect(body.entries).toHaveLength(1);
  expect(body.entries[0].next.source).toBe('STORE');
});
