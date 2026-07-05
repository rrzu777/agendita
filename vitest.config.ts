import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.worktrees/**',
      // Los worktrees de Claude viven bajo .claude/worktrees/ — sin esto, correr
      // vitest desde el checkout principal ejecuta copias duplicadas de los tests.
      '.claude/**',
      'tests/e2e/**',
      'tests/integration/**',
      'playwright.config.ts',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
