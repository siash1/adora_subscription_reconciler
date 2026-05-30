import { SourceContribution, StoreEvent, StoreEventType } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

export type StoreStatus = 'NONE' | 'ACTIVE' | 'CANCELED' | 'BILLING_ISSUE' | 'EXPIRED';

export interface StoreState {
  status: StoreStatus;
  expiresAtMs: number | null;
  lastType: StoreEventType | null;
}

export function entitlementPeriodMs(productId: string | null): number {
  if (!productId) return MONTH_MS;
  const id = productId.toLowerCase();
  if (id.includes('year') || id.includes('annual')) return YEAR_MS;
  if (id.includes('week')) return 7 * DAY_MS;
  return MONTH_MS;
}

function sortEvents(events: StoreEvent[]): StoreEvent[] {
  return [...events].sort((a, b) => {
    if (a.eventTimeMs !== b.eventTimeMs) return a.eventTimeMs - b.eventTimeMs;
    if (a.eventId < b.eventId) return -1;
    if (a.eventId > b.eventId) return 1;
    return 0;
  });
}

export function foldStoreEvents(events: StoreEvent[]): StoreState {
  let status: StoreStatus = 'NONE';
  let expiresAtMs: number | null = null;
  let lastType: StoreEventType | null = null;

  for (const event of sortEvents(events)) {
    let effective = false;
    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
        status = 'ACTIVE';
        expiresAtMs = event.eventTimeMs + entitlementPeriodMs(event.productId);
        effective = true;
        break;
      case 'CANCELLATION':
        if (status === 'ACTIVE' || status === 'BILLING_ISSUE') {
          status = 'CANCELED';
          effective = true;
        }
        break;
      case 'UN_CANCELLATION':
        if (status === 'CANCELED' || status === 'BILLING_ISSUE') {
          status = 'ACTIVE';
          effective = true;
        }
        break;
      case 'BILLING_ISSUE':
        if (status === 'ACTIVE' || status === 'CANCELED') {
          status = 'BILLING_ISSUE';
          effective = true;
        }
        break;
      case 'EXPIRATION':
        status = 'EXPIRED';
        expiresAtMs = event.eventTimeMs;
        effective = true;
        break;
    }
    if (effective) lastType = event.type;
  }

  return { status, expiresAtMs, lastType };
}

export function storeContribution(state: StoreState, nowMs: number): SourceContribution {
  const active =
    state.status !== 'NONE' &&
    state.status !== 'EXPIRED' &&
    state.expiresAtMs !== null &&
    state.expiresAtMs > nowMs;
  return {
    source: 'STORE',
    active,
    expiresAtMs: state.expiresAtMs,
    reason: state.lastType,
  };
}
