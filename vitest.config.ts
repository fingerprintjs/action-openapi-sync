import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json', 'json-summary', 'lcov', 'html', 'clover'],
      exclude: ['src/types.ts', 'src/cli-*.ts'],
    },
  },
})
