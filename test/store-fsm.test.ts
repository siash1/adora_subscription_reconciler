import { describe, expect, it } from 'vitest';
import { entitlementPeriodMs, foldStoreEvents, storeContribution } from '../src/domain/store';
import { storeEvent, DAY, MONTH, T0 } from './helpers';

describe('store event folding', () => {
  it('produces the same state regardless of arrival order', () => {
    const events = [
      storeEvent('a', 'u', 'INITIAL_PURCHASE', T0),
      storeEvent('b', 'u', 'RENEWAL', T0 + MONTH),
      storeEvent('c', 'u', 'CANCELLATION', T0 + MONTH + DAY),
    ];
    const forward = foldStoreEvents(events);
    const reversed = foldStoreEvents([...events].reverse());
    expect(forward).toEqual(reversed);
    expect(forward.status).toBe('CANCELED');
    expect(forward.expiresAtMs).toBe(T0 + 2 * MONTH);
  });

  it('keeps a cancelled subscription entitled until expiry', () => {
    const state = foldStoreEvents([
      storeEvent('a', 'u', 'INITIAL_PURCHASE', T0),
      storeEvent('b', 'u', 'CANCELLATION', T0 + DAY),
    ]);
    expect(state.status).toBe('CANCELED');
    expect(state.lastType).toBe('CANCELLATION');
    expect(storeContribution(state, T0 + 10 * DAY).active).toBe(true);
    expect(storeContribution(state, T0 + 40 * DAY).active).toBe(false);
  });

  it('reactivates after un-cancellation', () => {
    const state = foldStoreEvents([
      storeEvent('a', 'u', 'INITIAL_PURCHASE', T0),
      storeEvent('b', 'u', 'CANCELLATION', T0 + DAY),
      storeEvent('c', 'u', 'UN_CANCELLATION', T0 + 2 * DAY),
    ]);
    expect(state.status).toBe('ACTIVE');
    expect(state.lastType).toBe('UN_CANCELLATION');
  });

  it('recovers a billing issue back to active on un-cancellation', () => {
    const state = foldStoreEvents([
      storeEvent('a', 'u', 'INITIAL_PURCHASE', T0),
      storeEvent('b', 'u', 'BILLING_ISSUE', T0 + DAY),
      storeEvent('c', 'u', 'UN_CANCELLATION', T0 + 2 * DAY),
    ]);
    expect(state.status).toBe('ACTIVE');
    expect(state.expiresAtMs).toBe(T0 + MONTH);
  });

  it('treats billing issues as entitled until expiry', () => {
    const state = foldStoreEvents([
      storeEvent('a', 'u', 'INITIAL_PURCHASE', T0),
      storeEvent('b', 'u', 'BILLING_ISSUE', T0 + DAY),
    ]);
    expect(state.status).toBe('BILLING_ISSUE');
    expect(storeContribution(state, T0 + 10 * DAY).active).toBe(true);
  });

  it('ends entitlement on expiration', () => {
    const state = foldStoreEvents([
      storeEvent('a', 'u', 'INITIAL_PURCHASE', T0),
      storeEvent('b', 'u', 'EXPIRATION', T0 + 5 * DAY),
    ]);
    expect(state.status).toBe('EXPIRED');
    expect(storeContribution(state, T0 + 6 * DAY).active).toBe(false);
  });

  it('treats a lone expiration as an inactive expired state', () => {
    const state = foldStoreEvents([storeEvent('e', 'u', 'EXPIRATION', T0 + 5 * DAY)]);
    expect(state.status).toBe('EXPIRED');
    expect(state.expiresAtMs).toBe(T0 + 5 * DAY);
    expect(storeContribution(state, T0 + 6 * DAY).active).toBe(false);
  });

  it('ignores a cancellation with no prior purchase and surfaces no reason', () => {
    const state = foldStoreEvents([storeEvent('c', 'u', 'CANCELLATION', T0)]);
    expect(state.status).toBe('NONE');
    expect(state.expiresAtMs).toBeNull();
    expect(state.lastType).toBeNull();
    expect(storeContribution(state, T0 + DAY).reason).toBeNull();
  });

  it('ignores a billing issue with no prior purchase', () => {
    const state = foldStoreEvents([storeEvent('b', 'u', 'BILLING_ISSUE', T0)]);
    expect(state.status).toBe('NONE');
    expect(storeContribution(state, T0 + DAY).active).toBe(false);
  });

  it('treats un-cancellation of a never-cancelled subscription as a no-op', () => {
    const state = foldStoreEvents([
      storeEvent('p', 'u', 'INITIAL_PURCHASE', T0),
      storeEvent('x', 'u', 'UN_CANCELLATION', T0 + DAY),
    ]);
    expect(state.status).toBe('ACTIVE');
    expect(state.expiresAtMs).toBe(T0 + MONTH);
    expect(state.lastType).toBe('INITIAL_PURCHASE');
  });

  it('breaks same-timestamp ties deterministically by event id', () => {
    const base = storeEvent('0', 'u', 'INITIAL_PURCHASE', T0);
    const expiration = storeEvent('a', 'u', 'EXPIRATION', T0 + 10 * DAY);
    const renewal = storeEvent('b', 'u', 'RENEWAL', T0 + 10 * DAY);
    const forward = foldStoreEvents([base, expiration, renewal]);
    const reversed = foldStoreEvents([renewal, expiration, base]);
    expect(forward).toEqual(reversed);
    expect(forward.status).toBe('ACTIVE');
    expect(forward.expiresAtMs).toBe(T0 + 10 * DAY + MONTH);
  });

  it('lets a later-sorted expiration win a same-timestamp tie', () => {
    const state = foldStoreEvents([
      storeEvent('0', 'u', 'INITIAL_PURCHASE', T0),
      storeEvent('r1', 'u', 'RENEWAL', T0 + 10 * DAY),
      storeEvent('x9', 'u', 'EXPIRATION', T0 + 10 * DAY),
    ]);
    expect(state.status).toBe('EXPIRED');
    expect(state.expiresAtMs).toBe(T0 + 10 * DAY);
  });

  it('extends expiry to the latest renewal period across multiple renewals', () => {
    const events = [
      storeEvent('p', 'u', 'INITIAL_PURCHASE', T0),
      storeEvent('r1', 'u', 'RENEWAL', T0 + 30 * DAY),
      storeEvent('r2', 'u', 'RENEWAL', T0 + 60 * DAY),
    ];
    const state = foldStoreEvents(events);
    const shuffled = foldStoreEvents([events[2], events[0], events[1]]);
    expect(state).toEqual(shuffled);
    expect(state.expiresAtMs).toBe(T0 + 90 * DAY);
    expect(storeContribution(state, T0 + 85 * DAY).active).toBe(true);
    expect(storeContribution(state, T0 + 91 * DAY).active).toBe(false);
  });

  it('reactivates on a renewal after expiration but stays inactive if that period also lapsed', () => {
    const state = foldStoreEvents([
      storeEvent('p', 'u', 'INITIAL_PURCHASE', T0),
      storeEvent('e', 'u', 'EXPIRATION', T0 + 30 * DAY),
      storeEvent('r', 'u', 'RENEWAL', T0 + 31 * DAY),
    ]);
    expect(state.status).toBe('ACTIVE');
    expect(state.expiresAtMs).toBe(T0 + 61 * DAY);
    expect(storeContribution(state, T0 + 90 * DAY).active).toBe(false);
  });

  it('is inactive exactly at the expiry instant and active one millisecond before', () => {
    const state = foldStoreEvents([storeEvent('p', 'u', 'INITIAL_PURCHASE', T0)]);
    expect(storeContribution(state, T0 + MONTH).active).toBe(false);
    expect(storeContribution(state, T0 + MONTH - 1).active).toBe(true);
  });

  it('handles a zero event time', () => {
    const state = foldStoreEvents([storeEvent('p', 'u', 'INITIAL_PURCHASE', 0)]);
    expect(state.expiresAtMs).toBe(MONTH);
    expect(storeContribution(state, MONTH - 1).active).toBe(true);
    expect(storeContribution(state, MONTH).active).toBe(false);
  });

  it('folds negative (pre-epoch) event times order-independently', () => {
    const forward = foldStoreEvents([
      storeEvent('p', 'u', 'INITIAL_PURCHASE', -100000),
      storeEvent('e', 'u', 'EXPIRATION', -50000),
    ]);
    const reversed = foldStoreEvents([
      storeEvent('e', 'u', 'EXPIRATION', -50000),
      storeEvent('p', 'u', 'INITIAL_PURCHASE', -100000),
    ]);
    expect(forward).toEqual(reversed);
    expect(forward.status).toBe('EXPIRED');
    expect(forward.expiresAtMs).toBe(-50000);
  });
});

describe('period derivation', () => {
  it('derives monthly, yearly, weekly and default periods', () => {
    expect(entitlementPeriodMs('premium_monthly')).toBe(30 * DAY);
    expect(entitlementPeriodMs('premium_yearly')).toBe(365 * DAY);
    expect(entitlementPeriodMs('premium_weekly')).toBe(7 * DAY);
    expect(entitlementPeriodMs('something_else')).toBe(30 * DAY);
  });

  it('matches period keywords case-insensitively', () => {
    expect(entitlementPeriodMs('PREMIUM_YEARLY')).toBe(365 * DAY);
    expect(entitlementPeriodMs('premium_annual')).toBe(365 * DAY);
  });

  it('falls back to a 30-day period for empty or null product ids', () => {
    expect(entitlementPeriodMs('')).toBe(30 * DAY);
    expect(entitlementPeriodMs(null)).toBe(30 * DAY);
  });
});
