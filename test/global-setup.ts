import { Client } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/reconciler_test';

export default async function setup(): Promise<void> {
  process.env.DATABASE_URL = DATABASE_URL;

  const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, '');
  const adminUrl = new URL(DATABASE_URL);
  adminUrl.pathname = '/postgres';

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    }
  } finally {
    await admin.end();
  }

  const { migrate } = await import('../src/db/migrate');
  await migrate();
  const { pool } = await import('../src/db/pool');
  await pool.end();
}
