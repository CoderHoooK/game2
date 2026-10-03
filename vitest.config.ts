import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
    testTimeout: 120000,
    hookTimeout: 120000,
    // 压测要独占 CPU：文件串行跑
    fileParallelism: false,
  },
});
