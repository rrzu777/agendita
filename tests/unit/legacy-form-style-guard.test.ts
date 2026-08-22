import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE_ROOT = join(process.cwd(), 'src')
const SOURCE_EXTENSIONS = new Set(['.css', '.ts', '.tsx'])
const NATIVE_INPUT_PRIMITIVE = 'src/components/ui/input.tsx'
const NATIVE_SELECT_EXCEPTIONS = new Set([
  'src/components/dashboard/calendar-views.tsx',
  'src/components/ui/native-select.tsx',
])
const NATIVE_TEXTAREA_PRIMITIVE = 'src/components/ui/textarea.tsx'
const INTENTIONAL_NATIVE_INPUT_TYPES = new Set(['checkbox', 'file', 'hidden', 'radio'])

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

  it('keeps visible text-like controls on the shared form primitives', () => {
    const offenders = sourceFiles(SOURCE_ROOT).flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      const projectPath = relative(process.cwd(), path)
      const tags = source.match(/<input\b[\s\S]*?>/g) ?? []

      if (projectPath === NATIVE_INPUT_PRIMITIVE) return []

      return tags
        .filter((tag) => {
          const type = tag.match(/\btype\s*=\s*["']([^"']+)["']/)?.[1]
          return !type || !INTENTIONAL_NATIVE_INPUT_TYPES.has(type)
        })
        .map(() => projectPath)
    })

    expect(offenders).toEqual([])
  })

  it('limits native selects and textareas to documented primitives and exceptions', () => {
    const selectOffenders = sourceFiles(SOURCE_ROOT)
      .filter((path) => readFileSync(path, 'utf8').match(/<select\b[\s\S]*?>/))
      .map((path) => relative(process.cwd(), path))
      .filter((path) => !NATIVE_SELECT_EXCEPTIONS.has(path))

    const textareaOffenders = sourceFiles(SOURCE_ROOT)
      .filter((path) => readFileSync(path, 'utf8').match(/<textarea\b[\s\S]*?>/))
      .map((path) => relative(process.cwd(), path))
      .filter((path) => path !== NATIVE_TEXTAREA_PRIMITIVE)

    expect({ selectOffenders, textareaOffenders }).toEqual({
      selectOffenders: [],
      textareaOffenders: [],
    })
  })
})
