import { beforeEach, expect, it } from 'vitest';
import { resetDb, storeEvent, DAY, MONTH, T0 } from './helpers';
import { ingestStoreEvent } from '../src/services/store';
import { grantMarketplace, revokeMarketplace } from '../src/services/marketplace';
import { applyCarrierResult, enrollCarrier } from '../src/services/carrier';
import { getEntitlement } from '../src/services/entitlement';
import { pool } from '../src/db/pool';

beforeEach(resetDb);

async function entitlementRow(userId: string) {
  const { rows } = await pool.query(
    'SELECT active, source, expires_at, reason, last_changed_at, updated_at FROM user_entitlements WHERE user_id = $1',
    [userId],
  );
  return rows[0];
}

it('prefers an indefinite marketplace grant over a finite store grant', async () => {
  const now = T0 + DAY;
  await ingestStoreEvent(storeEvent('p', 'u_pre', 'INITIAL_PURCHASE', T0), now);
  await grantMarketplace(['u_pre'], now);

  let view = await getEntitlement('u_pre');
  expect(view.active).toBe(true);
  expect(view.source).toBe('MARKETPLACE');
  expect(view.expiresAt).toBeNull();

  await revokeMarketplace(['u_pre'], now);
  view = await getEntitlement('u_pre');
  expect(view.active).toBe(true);
  expect(view.source).toBe('STORE');
  expect(view.expiresAt).toBe(new Date(T0 + MONTH).toISOString());
});

it('revokes only marketplace-granted access', async () => {
  const now = T0 + DAY;
  await ingestStoreEvent(storeEvent('p', 'u_iso', 'INITIAL_PURCHASE', T0), now);
  await revokeMarketplace(['u_iso'], now);

  const view = await getEntitlement('u_iso');
  expect(view.active).toBe(true);
  expect(view.source).toBe('STORE');
});

it('selects the marketplace winner when all three sources are active', async () => {
  const now = T0 + DAY;
  await ingestStoreEvent(storeEvent('p', 'u_all', 'INITIAL_PURCHASE', T0, 'premium_yearly'), now);
  await enrollCarrier('u_all');
  await applyCarrierResult('u_all', 'active', now);
  await grantMarketplace(['u_all'], now);

  const view = await getEntitlement('u_all');
  expect(view.active).toBe(true);
  expect(view.source).toBe('MARKETPLACE');
  expect(view.expiresAt).toBeNull();
  expect(view.reason).toBe('MARKETPLACE_GRANT');
});

it('breaks an indefinite carrier-vs-marketplace tie in favour of marketplace', async () => {
  const now = T0 + DAY;
  await enrollCarrier('u_tie');
  await applyCarrierResult('u_tie', 'active', now);
  await grantMarketplace(['u_tie'], now);

  const view = await getEntitlement('u_tie');
  expect(view.source).toBe('MARKETPLACE');
});

it('lets an indefinite carrier grant outrank a far-future finite store grant', async () => {
  const now = T0 + DAY;
  await ingestStoreEvent(storeEvent('p', 'u_far', 'INITIAL_PURCHASE', T0, 'premium_yearly'), now);
  await enrollCarrier('u_far');
  await applyCarrierResult('u_far', 'active', now);

  const view = await getEntitlement('u_far');
  expect(view.source).toBe('CARRIER');
  expect(view.expiresAt).toBeNull();
});

it('falls back from marketplace to carrier when the marketplace grant is revoked', async () => {
  const now = T0 + DAY;
  await ingestStoreEvent(storeEvent('p', 'u_flip', 'INITIAL_PURCHASE', T0), now);
  await enrollCarrier('u_flip');
  await applyCarrierResult('u_flip', 'active', now);
  await grantMarketplace(['u_flip'], now);
  expect((await getEntitlement('u_flip')).source).toBe('MARKETPLACE');

  await revokeMarketplace(['u_flip'], now);
  const view = await getEntitlement('u_flip');
  expect(view.active).toBe(true);
  expect(view.source).toBe('CARRIER');
});

it('falls back from carrier to store when the carrier plan goes inactive', async () => {
  const now = T0 + DAY;
  await ingestStoreEvent(storeEvent('p', 'u_back', 'INITIAL_PURCHASE', T0), now);
  await enrollCarrier('u_back');
  await applyCarrierResult('u_back', 'active', now);
  expect((await getEntitlement('u_back')).source).toBe('CARRIER');

  await applyCarrierResult('u_back', 'inactive', now);
  const view = await getEntitlement('u_back');
  expect(view.active).toBe(true);
  expect(view.source).toBe('STORE');
  expect(view.expiresAt).toBe(new Date(T0 + MONTH).toISOString());
});

it('keeps a user premium through the carrier when the store grant has lapsed', async () => {
  const now = T0 + 45 * DAY;
  await ingestStoreEvent(storeEvent('p', 'u_car', 'INITIAL_PURCHASE', T0), now);
  await enrollCarrier('u_car');
  await applyCarrierResult('u_car', 'active', now);

  let view = await getEntitlement('u_car');
  expect(view.active).toBe(true);
  expect(view.source).toBe('CARRIER');

  await applyCarrierResult('u_car', 'inactive', now);
  view = await getEntitlement('u_car');
  expect(view.active).toBe(false);
  expect(view.source).toBe('NONE');
});

it('surfaces the cancellation reason while a cancelled grant is still active', async () => {
  const now = T0 + 10 * DAY;
  await ingestStoreEvent(storeEvent('p', 'u_reason', 'INITIAL_PURCHASE', T0), now);
  await ingestStoreEvent(storeEvent('c', 'u_reason', 'CANCELLATION', T0 + DAY), now);

  const view = await getEntitlement('u_reason');
  expect(view.active).toBe(true);
  expect(view.source).toBe('STORE');
  expect(view.reason).toBe('CANCELLATION');
  expect(view.expiresAt).toBe(new Date(T0 + MONTH).toISOString());
});

it('surfaces the expiration reason after a grant lapses to NONE', async () => {
  const now = T0 + 20 * DAY;
  await ingestStoreEvent(storeEvent('p', 'u_exp', 'INITIAL_PURCHASE', T0), now);
  await ingestStoreEvent(storeEvent('e', 'u_exp', 'EXPIRATION', T0 + 10 * DAY), now);

  const view = await getEntitlement('u_exp');
  expect(view.active).toBe(false);
  expect(view.source).toBe('NONE');
  expect(view.reason).toBe('EXPIRATION');
  expect(view.expiresAt).toBeNull();
});

it('does not bump last_changed_at on an idempotent reconcile', async () => {
  await ingestStoreEvent(storeEvent('p', 'u_idem', 'INITIAL_PURCHASE', T0), T0 + DAY);
  const before = await entitlementRow('u_idem');

  await ingestStoreEvent(storeEvent('p', 'u_idem', 'INITIAL_PURCHASE', T0), T0 + 2 * DAY);
  const after = await entitlementRow('u_idem');

  expect(after.last_changed_at.getTime()).toBe(before.last_changed_at.getTime());
  expect(after.updated_at.getTime()).toBe(T0 + 2 * DAY);
});

it('does not bump last_changed_at when re-granting an already-granted marketplace user', async () => {
  await grantMarketplace(['u_reg'], T0 + DAY);
  const before = await entitlementRow('u_reg');

  const second = await grantMarketplace(['u_reg'], T0 + 2 * DAY);
  const after = await entitlementRow('u_reg');

  expect(second.granted).toBe(0);
  expect(after.last_changed_at.getTime()).toBe(before.last_changed_at.getTime());
});
