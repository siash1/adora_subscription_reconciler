import { describe, expect, it } from 'vitest';
import { pickCanonical } from '../src/domain/reconcile';
import { SourceContribution } from '../src/domain/types';

function contribution(
  source: SourceContribution['source'],
  active: boolean,
  expiresAtMs: number | null,
  reason: string | null,
): SourceContribution {
  return { source, active, expiresAtMs, reason };
}

describe('pickCanonical', () => {
  it('returns NONE and surfaces the store reason when nothing is active', () => {
    const result = pickCanonical([
      contribution('STORE', false, null, 'EXPIRATION'),
      contribution('CARRIER', false, null, null),
      contribution('MARKETPLACE', false, null, null),
    ]);
    expect(result).toMatchObject({ active: false, source: 'NONE', expiresAtMs: null, reason: 'EXPIRATION' });
  });

  it('returns a null reason for NONE when there is no store contribution', () => {
    const result = pickCanonical([contribution('CARRIER', false, null, null)]);
    expect(result.reason).toBeNull();
  });

  it('returns the only active source', () => {
    const result = pickCanonical([
      contribution('STORE', true, 123, 'RENEWAL'),
      contribution('CARRIER', false, null, null),
    ]);
    expect(result).toMatchObject({ active: true, source: 'STORE', expiresAtMs: 123, reason: 'RENEWAL' });
  });

  it('prefers an indefinite grant over a finite one', () => {
    const result = pickCanonical([
      contribution('STORE', true, 1000, 'RENEWAL'),
      contribution('CARRIER', true, null, 'CARRIER_ACTIVE'),
    ]);
    expect(result.source).toBe('CARRIER');
    expect(result.expiresAtMs).toBeNull();
  });

  it('prefers the later finite expiry', () => {
    const result = pickCanonical([
      contribution('STORE', true, 2000, 'RENEWAL'),
      contribution('MARKETPLACE', true, 1000, 'MARKETPLACE_GRANT'),
    ]);
    expect(result.source).toBe('STORE');
    expect(result.expiresAtMs).toBe(2000);
  });

  it('breaks an equal finite expiry tie by source priority', () => {
    const result = pickCanonical([
      contribution('CARRIER', true, 5000, 'a'),
      contribution('STORE', true, 5000, 'b'),
      contribution('MARKETPLACE', true, 5000, 'c'),
    ]);
    expect(result.source).toBe('STORE');
  });

  it('breaks an indefinite tie in favour of marketplace over carrier', () => {
    const result = pickCanonical([
      contribution('CARRIER', true, null, 'a'),
      contribution('MARKETPLACE', true, null, 'b'),
    ]);
    expect(result.source).toBe('MARKETPLACE');
  });
});
