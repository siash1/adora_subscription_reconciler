import { Router } from 'express';
import { getEntitlement } from '../services/entitlement';
import { enrollCarrier } from '../services/carrier';

export const entitlementRouter = Router();

entitlementRouter.get('/users/:id/entitlement', async (req, res, next) => {
  try {
    const view = await getEntitlement(req.params.id);
    return res.json(view);
  } catch (err) {
    return next(err);
  }
});

entitlementRouter.post('/users/:id/carrier/enroll', async (req, res, next) => {
  try {
    await enrollCarrier(req.params.id);
    return res.status(201).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});
