import { CanonicalEntitlement } from '../domain/types';

export interface EntitlementView {
  active: boolean;
  source: string;
  expiresAt: string | null;
  lastChangedAt: string | null;
  reason: string | null;
}

export function serializeCanonical(c: CanonicalEntitlement): Omit<EntitlementView, 'lastChangedAt'> {
  return {
    active: c.active,
    source: c.source,
    expiresAt: c.expiresAtMs === null ? null : new Date(c.expiresAtMs).toISOString(),
    reason: c.reason,
  };
}
