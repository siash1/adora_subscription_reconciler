import { Router } from 'express';
import { getTimeline } from '../services/audit';

export const timelineRouter = Router();

timelineRouter.get('/users/:id/timeline', async (req, res, next) => {
  try {
    const entries = await getTimeline(req.params.id);
    return res.json({ userId: req.params.id, entries });
  } catch (err) {
    return next(err);
  }
});
