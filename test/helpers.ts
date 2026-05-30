import { pool } from '../src/db/pool';
import { StoreEvent, StoreEventType } from '../src/domain/types';

export const DAY = 24 * 60 * 60 * 1000;
export const HOUR = 60 * 60 * 1000;
export const MONTH = 30 * DAY;
export const T0 = Date.UTC(2026, 0, 1);

export async function resetDb(): Promise<void> {
  await pool.query(`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations' LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
      END LOOP;
    END $$;
  `);
}

export function storeEvent(
  eventId: string,
  userId: string,
  type: StoreEventType,
  eventTimeMs: number,
  productId = 'premium_monthly',
): StoreEvent {
  return { eventId, userId, type, eventTimeMs, productId };
}

export async function notificationCount(userId: string): Promise<number> {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1',
    [userId],
  );
  return rows[0].n;
}
