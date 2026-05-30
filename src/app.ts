import express, { NextFunction, Request, Response } from 'express';
import { storeRouter } from './routes/store';
import { marketplaceRouter } from './routes/marketplace';
import { entitlementRouter } from './routes/entitlement';
import { timelineRouter } from './routes/timeline';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use(storeRouter);
  app.use(marketplaceRouter);
  app.use(entitlementRouter);
  app.use(timelineRouter);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid_json' });
    }
    console.error(err);
    return res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
