import fs from 'node:fs/promises'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { describe, expect, it } from 'vitest'

describe('semantic color tokens', () => {
  it('compiles warning and success utilities from the canonical globals theme', async () => {
    const css = await fs.readFile('src/app/globals.css', 'utf8')
    const result = await postcss([tailwindcss()]).process(css, { from: 'src/app/globals.css' })

    expect(result.css).toMatch(/\.text-warning\s*\{[^}]*color:\s*var\(--warning\)/)
    expect(result.css).toMatch(/\.text-success\s*\{[^}]*color:\s*var\(--success\)/)
    expect(result.css).toContain('--warning:')
    expect(result.css).toContain('--success:')
  })
})
