import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Heavy Next.js modules can saturate local/CI runners and trigger false
    // hook timeouts when Vitest uses every available core.
    maxWorkers: 4,
    setupFiles: ['./tests/helpers/react-dom.tsx'],
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
      'src/**/*.integration.test.ts',
      'playwright.config.ts',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './tests/helpers/server-only.ts'),
    },
  },
})
