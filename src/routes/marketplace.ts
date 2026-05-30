import { Router } from 'express';
import { z } from 'zod';
import { grantMarketplace, revokeMarketplace } from '../services/marketplace';

const bodySchema = z.object({
  userIds: z.array(z.string().min(1)).min(1),
});

export const marketplaceRouter = Router();

marketplaceRouter.post('/webhooks/marketplace/revoke', async (req, res, next) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
  }
  try {
    const result = await revokeMarketplace(parsed.data.userIds);
    return res.json({ ok: true, revoked: result.revoked });
  } catch (err) {
    return next(err);
  }
});

marketplaceRouter.post('/webhooks/marketplace/grant', async (req, res, next) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
  }
  try {
    const result = await grantMarketplace(parsed.data.userIds);
    return res.json({ ok: true, granted: result.granted });
  } catch (err) {
    return next(err);
  }
});
