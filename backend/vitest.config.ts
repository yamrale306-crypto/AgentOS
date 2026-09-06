import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    clearMocks: true
  },
  resolve: {
    extensions: ['.ts', '.js', '.mjs', '.json']
  }
});