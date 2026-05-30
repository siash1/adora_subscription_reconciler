import express from 'express';

const PORT = Number(process.env.MOCK_CARRIER_PORT ?? 4000);
const ACTIVE_RATE = Number(process.env.MOCK_CARRIER_ACTIVE_RATE ?? 0.85);
const INACTIVE_RATE = Number(process.env.MOCK_CARRIER_INACTIVE_RATE ?? 0.1);

export function createMockCarrierApp() {
  const app = express();

  app.get('/mock/carrier/plan', (req, res) => {
    const force = req.query.force;
    if (force === 'active' || force === 'inactive') {
      return res.json({ status: force });
    }
    if (force === 'api_error') {
      return res.status(500).json({ status: 'api_error' });
    }

    const roll = Math.random();
    if (roll < ACTIVE_RATE) return res.json({ status: 'active' });
    if (roll < ACTIVE_RATE + INACTIVE_RATE) return res.json({ status: 'inactive' });
    return res.status(500).json({ status: 'api_error' });
  });

  return app;
}

if (require.main === module) {
  createMockCarrierApp().listen(PORT, () => console.log(`mock carrier listening on ${PORT}`));
}
