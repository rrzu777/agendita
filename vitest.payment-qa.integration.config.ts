import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    name: 'payment-qa-integration',
    environment: 'node',
    globals: true,
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ['./tests/helpers/payment-qa-network-deny.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './tests/helpers/server-only.ts'),
    },
  },
})
