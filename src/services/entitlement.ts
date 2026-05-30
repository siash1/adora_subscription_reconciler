import { pool } from '../db/pool';
import { EntitlementView } from './view';

export async function getEntitlement(userId: string): Promise<EntitlementView> {
  const { rows } = await pool.query(
    'SELECT active, source, expires_at, reason, last_changed_at FROM user_entitlements WHERE user_id = $1',
    [userId],
  );
  const row = rows[0];
  if (!row) {
    return { active: false, source: 'NONE', expiresAt: null, lastChangedAt: null, reason: null };
  }
  return {
    active: row.active,
    source: row.source,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    lastChangedAt: row.last_changed_at ? row.last_changed_at.toISOString() : null,
    reason: row.reason,
  };
}
