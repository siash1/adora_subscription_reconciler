import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { pool, withClient } from './pool';

const MIGRATIONS_DIR = join(__dirname, 'migrations');
const MIGRATION_LOCK_KEY = 911002;

export async function migrate(): Promise<string[]> {
  return withClient(async (client) => {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    const applied: string[] = [];
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           name TEXT PRIMARY KEY,
           applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
         )`,
      );
      const done = new Set(
        (await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
      );
      const files = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      for (const file of files) {
        if (done.has(file)) continue;
        const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
        }
        applied.push(file);
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
    return applied;
  });
}

if (require.main === module) {
  migrate()
    .then((applied) => {
      for (const file of applied) console.log(`applied ${file}`);
      console.log(applied.length === 0 ? 'database already up to date' : `applied ${applied.length} migration(s)`);
      return pool.end();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
