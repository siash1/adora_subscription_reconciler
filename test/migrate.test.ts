import { expect, it } from 'vitest';
import { migrate } from '../src/db/migrate';
import { pool } from '../src/db/pool';

it('is idempotent once the schema is up to date', async () => {
  const applied = await migrate();
  expect(applied).toEqual([]);
});

it('has recorded the initial migration', async () => {
  const { rows } = await pool.query("SELECT 1 FROM schema_migrations WHERE name = '001_init.sql'");
  expect(rows.length).toBe(1);
});
