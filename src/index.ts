import { config } from './config';
import { migrate } from './db/migrate';
import { createApp } from './app';
import { pool } from './db/pool';
import { startWorkers } from './workers/scheduler';

async function main(): Promise<void> {
  await migrate();

  let stopWorkers: () => void = () => {};

  if (config.role === 'all' || config.role === 'api') {
    const app = createApp();
    app.listen(config.port, () => console.log(`api listening on ${config.port} (role=${config.role})`));
  }

  if (config.role === 'all' || config.role === 'worker') {
    stopWorkers = startWorkers();
    console.log(`workers started (role=${config.role})`);
  }

  const shutdown = async () => {
    stopWorkers();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
