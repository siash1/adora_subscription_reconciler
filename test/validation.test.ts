import { AddressInfo } from 'net';
import { Server } from 'http';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { resetDb } from './helpers';
import { createApp } from '../src/app';
import { pool } from '../src/db/pool';

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

async function post(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function purchase(overrides: Record<string, unknown>) {
  return { eventId: 'e1', userId: 'u1', type: 'INITIAL_PURCHASE', eventTimeMs: 1, productId: 'premium_monthly', ...overrides };
}

it('rejects a non-numeric eventTimeMs', async () => {
  const res = await post('/webhooks/store', purchase({ eventTimeMs: '123' }));
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('invalid_event');
});

it('rejects a negative eventTimeMs but accepts zero', async () => {
  expect((await post('/webhooks/store', purchase({ eventId: 'neg', eventTimeMs: -1 }))).status).toBe(400);
  expect((await post('/webhooks/store', purchase({ eventId: 'zero', eventTimeMs: 0 }))).status).toBe(202);
});

it('rejects an empty productId but accepts null or omitted', async () => {
  expect((await post('/webhooks/store', purchase({ eventId: 'empty', productId: '' }))).status).toBe(400);
  expect((await post('/webhooks/store', purchase({ eventId: 'null', productId: null }))).status).toBe(202);
  const omitted = purchase({ eventId: 'omit' }) as Record<string, unknown>;
  delete omitted.productId;
  expect((await post('/webhooks/store', omitted)).status).toBe(202);
});

it('rejects an unknown event type', async () => {
  const res = await post('/webhooks/store', purchase({ type: 'NONSENSE' }));
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('invalid_event');
});

it('rejects missing required identifiers', async () => {
  const missingEvent = purchase({}) as Record<string, unknown>;
  delete missingEvent.eventId;
  expect((await post('/webhooks/store', missingEvent)).status).toBe(400);

  const missingUser = purchase({ eventId: 'has-id' }) as Record<string, unknown>;
  delete missingUser.userId;
  expect((await post('/webhooks/store', missingUser)).status).toBe(400);
});

it('ignores unknown extra fields', async () => {
  const res = await post('/webhooks/store', purchase({ eventId: 'extra', surprise: 'ignored' }));
  expect(res.status).toBe(202);
  expect(res.body.ok).toBe(true);
});

it('returns 400 for a malformed JSON body', async () => {
  const res = await fetch(`${baseUrl}/webhooks/store`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not valid json',
  });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe('invalid_json');
});

it('rejects an empty marketplace userIds array', async () => {
  expect((await post('/webhooks/marketplace/revoke', { userIds: [] })).status).toBe(400);
  expect((await post('/webhooks/marketplace/grant', { userIds: [] })).status).toBe(400);
});

it('rejects non-string entries in userIds', async () => {
  const res = await post('/webhooks/marketplace/revoke', { userIds: ['u_ok', 42] });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('invalid_request');
});

it('enrolls a carrier user idempotently without clobbering status', async () => {
  const first = await fetch(`${baseUrl}/users/u_enroll/carrier/enroll`, { method: 'POST' });
  expect(first.status).toBe(201);

  await pool.query("UPDATE carrier_state SET status = 'active' WHERE user_id = $1", ['u_enroll']);

  const second = await fetch(`${baseUrl}/users/u_enroll/carrier/enroll`, { method: 'POST' });
  expect(second.status).toBe(201);

  const { rows } = await pool.query('SELECT status FROM carrier_state WHERE user_id = $1', ['u_enroll']);
  expect(rows[0].status).toBe('active');
});
