import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE_ROOT = join(process.cwd(), 'src')
const SOURCE_EXTENSIONS = new Set(['.css', '.ts', '.tsx'])

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : []
  })
}

describe('legacy form style guard', () => {
  it('does not allow the removed studio-input escape hatch back into product code', () => {
    const offenders = sourceFiles(SOURCE_ROOT)
      .filter((path) => readFileSync(path, 'utf8').includes('studio-input'))
      .map((path) => relative(process.cwd(), path))

    expect(offenders).toEqual([])
  })
})
