import { CanonicalEntitlement, Source, SourceContribution } from './types';

const SOURCE_PRIORITY: Record<Source, number> = {
  STORE: 3,
  MARKETPLACE: 2,
  CARRIER: 1,
  NONE: 0,
};

export function pickCanonical(contributions: SourceContribution[]): CanonicalEntitlement {
  const active = contributions.filter((c) => c.active);

  if (active.length === 0) {
    const store = contributions.find((c) => c.source === 'STORE');
    return { active: false, source: 'NONE', expiresAtMs: null, reason: store?.reason ?? null };
  }

  active.sort((a, b) => {
    const aExpiry = a.expiresAtMs ?? Number.POSITIVE_INFINITY;
    const bExpiry = b.expiresAtMs ?? Number.POSITIVE_INFINITY;
    if (aExpiry !== bExpiry) return bExpiry - aExpiry;
    return SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source];
  });

  const winner = active[0];
  return {
    active: true,
    source: winner.source,
    expiresAtMs: winner.expiresAtMs,
    reason: winner.reason,
  };
}
