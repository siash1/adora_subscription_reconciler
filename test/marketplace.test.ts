import { beforeEach, expect, it } from 'vitest';
import { resetDb, T0 } from './helpers';
import { grantMarketplace, revokeMarketplace } from '../src/services/marketplace';

beforeEach(resetDb);

it('counts only newly granted users and de-duplicates the input', async () => {
  const now = T0;
  const first = await grantMarketplace(['u_a', 'u_a', 'u_b'], now);
  expect(first.granted).toBe(2);

  const second = await grantMarketplace(['u_a'], now);
  expect(second.granted).toBe(0);
});

it('counts only users whose marketplace access actually changed on revoke', async () => {
  const now = T0;
  await grantMarketplace(['u_a', 'u_b'], now);

  const revoked = await revokeMarketplace(['u_a', 'u_a', 'u_c'], now);
  expect(revoked.revoked).toBe(1);
});
