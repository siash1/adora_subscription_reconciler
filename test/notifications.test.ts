import { beforeEach, expect, it } from 'vitest';
import { resetDb, storeEvent, notificationCount, DAY, HOUR, MONTH, T0 } from './helpers';
import { ingestStoreEvent } from '../src/services/store';
import { grantMarketplace } from '../src/services/marketplace';
import { applyCarrierResult, enrollCarrier } from '../src/services/carrier';
import { reconcileUser } from '../src/services/reconciler';
import { scanForExpiringEntitlements, sendDueNotifications } from '../src/services/notifications';
import { pool } from '../src/db/pool';

beforeEach(resetDb);

async function seedEntitlement(userId: string, expiresAtMs: number, nowMs: number) {
  await pool.query(
    `INSERT INTO user_entitlements (user_id, active, source, expires_at, reason, last_changed_at, updated_at)
     VALUES ($1, true, 'STORE', $2, 'RENEWAL', $3, $3)`,
    [userId, new Date(expiresAtMs), new Date(nowMs)],
  );
}

it('schedules an expiring-soon notification at most once per expiry', async () => {
  const now = T0 + MONTH - 12 * HOUR;
  await ingestStoreEvent(storeEvent('p', 'u_n', 'INITIAL_PURCHASE', T0), now);

  await scanForExpiringEntitlements(now);
  await scanForExpiringEntitlements(now);

  expect(await notificationCount('u_n')).toBe(1);
});

it('schedules at exactly the 24h lead boundary', async () => {
  const now = T0 + MONTH - DAY;
  await ingestStoreEvent(storeEvent('p', 'u_bound', 'INITIAL_PURCHASE', T0), now);
  expect(await notificationCount('u_bound')).toBe(1);
});

it('does not schedule when expiry is just over 24h away', async () => {
  const now = T0 + MONTH - DAY - 1;
  await ingestStoreEvent(storeEvent('p', 'u_over', 'INITIAL_PURCHASE', T0), now);
  expect(await notificationCount('u_over')).toBe(0);
});

it('scan ignores expiries in the past or exactly at now', async () => {
  const now = T0 + DAY;
  await seedEntitlement('u_past', now - HOUR, now);
  await seedEntitlement('u_now', now, now);
  const scheduled = await scanForExpiringEntitlements(now);
  expect(scheduled).toBe(0);
  expect(await notificationCount('u_past')).toBe(0);
  expect(await notificationCount('u_now')).toBe(0);
});

it('scan schedules at exactly the 24h upper boundary', async () => {
  const now = T0 + DAY;
  await seedEntitlement('u_edge', now + DAY, now);
  const scheduled = await scanForExpiringEntitlements(now);
  expect(scheduled).toBe(1);

  const { rows } = await pool.query('SELECT target_expires_at, scheduled_for FROM notifications WHERE user_id = $1', ['u_edge']);
  expect(rows[0].target_expires_at.getTime()).toBe(now + DAY);
  expect(rows[0].scheduled_for.getTime()).toBe(now);
});

it('does not duplicate a notification across the reconcile and scan paths', async () => {
  const now = T0 + MONTH - 12 * HOUR;
  await ingestStoreEvent(storeEvent('p', 'u_dedupe', 'INITIAL_PURCHASE', T0), now);
  await scanForExpiringEntitlements(now);
  expect(await notificationCount('u_dedupe')).toBe(1);
});

it('does not schedule for an indefinite marketplace grant', async () => {
  const now = T0 + DAY;
  await grantMarketplace(['u_mk'], now);
  await scanForExpiringEntitlements(now);
  expect(await notificationCount('u_mk')).toBe(0);
});

it('does not schedule for an indefinite carrier grant', async () => {
  const now = T0 + DAY;
  await enrollCarrier('u_ca');
  await applyCarrierResult('u_ca', 'active', now);
  await scanForExpiringEntitlements(now);
  expect(await notificationCount('u_ca')).toBe(0);
});

it('suppresses scheduling when an indefinite marketplace grant shadows a soon-expiring store grant', async () => {
  const now = T0 + MONTH - 12 * HOUR;
  await grantMarketplace(['u_shadow'], now);
  await ingestStoreEvent(storeEvent('p', 'u_shadow', 'INITIAL_PURCHASE', T0), now);
  await scanForExpiringEntitlements(now);
  expect(await notificationCount('u_shadow')).toBe(0);
});

it('does not send a scheduled notification once the grant became indefinite', async () => {
  const now = T0 + MONTH - 12 * HOUR;
  await ingestStoreEvent(storeEvent('p', 'u_stale1', 'INITIAL_PURCHASE', T0), now);
  expect(await notificationCount('u_stale1')).toBe(1);

  await grantMarketplace(['u_stale1'], now);
  const sent = await sendDueNotifications(now);
  expect(sent).toBe(0);

  const { rows } = await pool.query('SELECT sent_at FROM notifications WHERE user_id = $1', ['u_stale1']);
  expect(rows[0].sent_at).toBeNull();
});

it('does not send a scheduled notification once the grant has lapsed', async () => {
  const now = T0 + MONTH - 12 * HOUR;
  await ingestStoreEvent(storeEvent('p', 'u_stale2', 'INITIAL_PURCHASE', T0), now);
  await ingestStoreEvent(storeEvent('e', 'u_stale2', 'EXPIRATION', now), now);

  const sent = await sendDueNotifications(now);
  expect(sent).toBe(0);
});

it('does not send a notification before its scheduled_for time', async () => {
  const now = T0 + DAY;
  await seedEntitlement('u_future', now + 2 * DAY, now);
  await pool.query(
    `INSERT INTO notifications (user_id, type, target_expires_at, scheduled_for)
     VALUES ($1, 'PREMIUM_EXPIRES_SOON', $2, $3)`,
    ['u_future', new Date(now + 2 * DAY), new Date(now + DAY)],
  );

  const sent = await sendDueNotifications(now);
  expect(sent).toBe(0);
});

it('schedules a separate notification when a renewal sets a new expiry', async () => {
  const now = T0 + MONTH - 12 * HOUR;
  await ingestStoreEvent(storeEvent('p', 'u_r', 'INITIAL_PURCHASE', T0), now);
  expect(await notificationCount('u_r')).toBe(1);

  await ingestStoreEvent(storeEvent('r', 'u_r', 'RENEWAL', T0 + HOUR), now);
  expect(await notificationCount('u_r')).toBe(2);
});

it('marks a due notification as sent exactly once', async () => {
  const now = T0 + MONTH - 12 * HOUR;
  await ingestStoreEvent(storeEvent('p', 'u_s', 'INITIAL_PURCHASE', T0), now);

  const sentFirst = await sendDueNotifications(now);
  const sentSecond = await sendDueNotifications(now);

  expect(sentFirst).toBe(1);
  expect(sentSecond).toBe(0);

  const { rows } = await pool.query('SELECT sent_at FROM notifications WHERE user_id = $1', ['u_s']);
  expect(rows[0].sent_at).not.toBeNull();
});

it('inserts at most one notification under concurrent reconciles for the same user', async () => {
  const now = T0 + DAY;
  const purchaseTime = now - (MONTH - 12 * HOUR);
  await pool.query(
    `INSERT INTO store_events (event_id, user_id, type, event_time_ms, product_id)
     VALUES ('p', 'u_conc', 'INITIAL_PURCHASE', $1, 'premium_monthly')`,
    [purchaseTime],
  );

  await Promise.all([reconcileUser('u_conc', { nowMs: now }), reconcileUser('u_conc', { nowMs: now })]);
  expect(await notificationCount('u_conc')).toBe(1);
});

it('schedules idempotently under concurrent scans', async () => {
  const now = T0 + DAY;
  await seedEntitlement('u_scan', now + 12 * HOUR, now);
  await Promise.all([scanForExpiringEntitlements(now), scanForExpiringEntitlements(now)]);
  expect(await notificationCount('u_scan')).toBe(1);
});

it('sends each due notification exactly once under many concurrent senders', async () => {
  const now = T0 + DAY;
  const count = 30;
  for (let i = 0; i < count; i += 1) {
    await seedEntitlement(`u_load${i}`, now + 12 * HOUR, now);
  }
  expect(await scanForExpiringEntitlements(now)).toBe(count);

  const sends = await Promise.all(Array.from({ length: 5 }, () => sendDueNotifications(now)));
  expect(sends.reduce((a, b) => a + b, 0)).toBe(count);

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM notifications WHERE sent_at IS NOT NULL');
  expect(rows[0].n).toBe(count);

  const again = await Promise.all([sendDueNotifications(now), sendDueNotifications(now)]);
  expect(again).toEqual([0, 0]);
});
