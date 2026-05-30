import { Router } from 'express';
import { z } from 'zod';
import { ingestStoreEvent } from '../services/store';

const bodySchema = z.object({
  eventId: z.string().min(1),
  userId: z.string().min(1),
  type: z.enum([
    'INITIAL_PURCHASE',
    'RENEWAL',
    'CANCELLATION',
    'BILLING_ISSUE',
    'EXPIRATION',
    'UN_CANCELLATION',
  ]),
  eventTimeMs: z.number().int().nonnegative(),
  productId: z.string().min(1).nullish(),
});

export const storeRouter = Router();

storeRouter.post('/webhooks/store', async (req, res, next) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_event', details: parsed.error.flatten() });
  }
  try {
    const result = await ingestStoreEvent({ ...parsed.data, productId: parsed.data.productId ?? null });
    return res.status(result.duplicate ? 200 : 202).json({
      ok: true,
      duplicate: result.duplicate,
      entitlement: result.entitlement,
    });
  } catch (err) {
    return next(err);
  }
});
