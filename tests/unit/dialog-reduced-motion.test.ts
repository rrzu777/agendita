import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('shared dialog reduced motion contract', () => {
  it('disables animation and duration for both overlay and content', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ui/dialog.tsx'), 'utf8')
    const overlayClasses = source.match(/function DialogOverlay[\s\S]*?className=\{cn\(\s*"([^"]+)"/)?.[1]
    const contentClasses = source.match(/function DialogContent[\s\S]*?className=\{cn\(\s*"([^"]+)"/)?.[1]

    for (const classes of [overlayClasses, contentClasses]) {
      expect(classes?.split(' ')).toContain('motion-reduce:animate-none')
      expect(classes?.split(' ')).toContain('motion-reduce:duration-0')
    }
  })
})
