import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')

function isUseClientModule(sourceFile: ts.SourceFile): boolean {
  const first = sourceFile.statements[0]
  return (
    !!first &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use client'
  )
}

export type UseClientModule = {
  relPath: string
  sourceFile: ts.SourceFile
}

/** Todos los módulos con directiva `'use client'` bajo `src/`, parseados. */
export function findUseClientModules(): UseClientModule[] {
  const out: UseClientModule[] = []

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue
      const text = fs.readFileSync(full, 'utf8')
      if (!text.includes('use client')) continue
      const sourceFile = ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true)
      if (isUseClientModule(sourceFile)) {
        out.push({ relPath: `src/${path.relative(SRC, full)}`, sourceFile })
      }
    }
  }

  walk(SRC)
  return out
}
