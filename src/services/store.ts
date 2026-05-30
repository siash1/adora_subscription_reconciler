import { withTransaction } from '../db/pool';
import { StoreEvent } from '../domain/types';
import { reconcileUserTx } from './reconciler';
import { serializeCanonical } from './view';

export interface IngestResult {
  duplicate: boolean;
  entitlement: ReturnType<typeof serializeCanonical>;
}

export async function ingestStoreEvent(event: StoreEvent, nowMs?: number): Promise<IngestResult> {
  return withTransaction(async (client) => {
    const insert = await client.query(
      `INSERT INTO store_events (event_id, user_id, type, event_time_ms, product_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id) DO NOTHING`,
      [event.eventId, event.userId, event.type, event.eventTimeMs, event.productId ?? null],
    );
    const duplicate = insert.rowCount === 0;
    const entitlement = await reconcileUserTx(client, event.userId, { eventId: event.eventId, nowMs });
    return { duplicate, entitlement: serializeCanonical(entitlement) };
  });
}
