import { withTransaction } from '../db/pool';
import { reconcileUserTx } from './reconciler';

function unique(userIds: string[]): string[] {
  return [...new Set(userIds)];
}

export async function revokeMarketplace(userIds: string[], nowMs?: number): Promise<{ revoked: number }> {
  let revoked = 0;
  for (const userId of unique(userIds)) {
    const changed = await withTransaction(async (client) => {
      const result = await client.query(
        `UPDATE marketplace_state SET status = 'revoked', updated_at = now()
         WHERE user_id = $1 AND status <> 'revoked'`,
        [userId],
      );
      const didChange = (result.rowCount ?? 0) > 0;
      if (didChange) await reconcileUserTx(client, userId, { nowMs });
      return didChange;
    });
    if (changed) revoked += 1;
  }
  return { revoked };
}

export async function grantMarketplace(userIds: string[], nowMs?: number): Promise<{ granted: number }> {
  let granted = 0;
  for (const userId of unique(userIds)) {
    const changed = await withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO marketplace_state (user_id, status) VALUES ($1, 'granted')
         ON CONFLICT (user_id) DO UPDATE SET status = 'granted', updated_at = now()
         WHERE marketplace_state.status <> 'granted'`,
        [userId],
      );
      const didChange = (result.rowCount ?? 0) > 0;
      if (didChange) await reconcileUserTx(client, userId, { nowMs });
      return didChange;
    });
    if (changed) granted += 1;
  }
  return { granted };
}
