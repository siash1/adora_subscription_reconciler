import { defineConfig } from 'vitest/config';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://ashish@localhost:5432/reconciler_test';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    poolOptions: { forks: { singleFork: true } },
    env: { DATABASE_URL },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
