import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup.ts'],
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['**/*.test.*'],
      thresholds: { lines: 95, functions: 95, branches: 95, statements: 95 },
    },
  },
  resolve: { tsconfigPaths: true },
});
