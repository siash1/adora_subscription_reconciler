export type Source = 'STORE' | 'CARRIER' | 'MARKETPLACE' | 'NONE';

export type StoreEventType =
  | 'INITIAL_PURCHASE'
  | 'RENEWAL'
  | 'CANCELLATION'
  | 'BILLING_ISSUE'
  | 'EXPIRATION'
  | 'UN_CANCELLATION';

export interface StoreEvent {
  eventId: string;
  userId: string;
  type: StoreEventType;
  eventTimeMs: number;
  productId: string | null;
}

export interface SourceContribution {
  source: Exclude<Source, 'NONE'>;
  active: boolean;
  expiresAtMs: number | null;
  reason: string | null;
}

export interface CanonicalEntitlement {
  active: boolean;
  source: Source;
  expiresAtMs: number | null;
  reason: string | null;
}
