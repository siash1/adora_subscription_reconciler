import { AddressInfo } from 'net';
import { Server } from 'http';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { resetDb } from './helpers';
import { createApp } from '../src/app';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(resetDb);

async function post(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json() };
}

it('ingests a store webhook and exposes the entitlement', async () => {
  const purchase = await post('/webhooks/store', {
    eventId: 'evt_api_1',
    userId: 'u_api',
    type: 'INITIAL_PURCHASE',
    eventTimeMs: Date.now(),
    productId: 'premium_monthly',
  });
  expect(purchase.status).toBe(202);
  expect(purchase.body.ok).toBe(true);
  expect(purchase.body.duplicate).toBe(false);

  const duplicate = await post('/webhooks/store', {
    eventId: 'evt_api_1',
    userId: 'u_api',
    type: 'INITIAL_PURCHASE',
    eventTimeMs: Date.now(),
    productId: 'premium_monthly',
  });
  expect(duplicate.status).toBe(200);
  expect(duplicate.body.duplicate).toBe(true);

  const entitlement = await get('/users/u_api/entitlement');
  expect(entitlement.status).toBe(200);
  expect(entitlement.body.active).toBe(true);
  expect(entitlement.body.source).toBe('STORE');
});

it('rejects an invalid store webhook payload', async () => {
  const res = await post('/webhooks/store', { userId: 'u_api', type: 'NONSENSE' });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('invalid_event');
});

it('returns NONE for an unknown user', async () => {
  const res = await get('/users/u_unknown/entitlement');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ active: false, source: 'NONE', expiresAt: null, lastChangedAt: null, reason: null });
});

it('revokes only marketplace access', async () => {
  await post('/webhooks/store', {
    eventId: 'evt_api_2',
    userId: 'u_api_mk',
    type: 'INITIAL_PURCHASE',
    eventTimeMs: Date.now(),
    productId: 'premium_monthly',
  });
  const revoke = await post('/webhooks/marketplace/revoke', { userIds: ['u_api_mk'] });
  expect(revoke.status).toBe(200);

  const entitlement = await get('/users/u_api_mk/entitlement');
  expect(entitlement.body.active).toBe(true);
  expect(entitlement.body.source).toBe('STORE');
});
