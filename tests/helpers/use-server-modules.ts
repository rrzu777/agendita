import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')

/**
 * Un módulo `'use server'` es el que tiene la directiva como PRIMERA sentencia
 * del archivo. La distinción importa: la misma directiva adentro del cuerpo de
 * una función (server action inline) es legal y no convierte al módulo en
 * server module — hay siete archivos así en `src/app` y `src/components`, y un
 * `grep 'use server'` los mete en la bolsa por error.
 */
function isUseServerModule(sf: ts.SourceFile): boolean {
  const first = sf.statements[0]
  return (
    !!first &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use server'
  )
}

export type UseServerModule = {
  /** Ruta relativa a la raíz del repo, para que el mensaje de error sea clickeable. */
  relPath: string
  sourceFile: ts.SourceFile
}

/** Todos los módulos `'use server'` bajo `src/`, parseados. */
export function findUseServerModules(): UseServerModule[] {
  const out: UseServerModule[] = []

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue
      const text = fs.readFileSync(full, 'utf8')
      // Filtro barato antes de parsear: parsear ~700 archivos es lento y de más.
      if (!text.includes('use server')) continue
      const sf = ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true)
      if (isUseServerModule(sf)) out.push({ relPath: `src/${path.relative(SRC, full)}`, sourceFile: sf })
    }
  }
  walk(SRC)

  return out
}

/** Nombre de la función llamada, si el nodo es una llamada a un identificador. */
export function calleeName(node: ts.CallExpression): string | null {
  const callee = node.expression
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text
  return null
}

/** Línea 1-indexada de un nodo, para citarla en el mensaje de error. */
export function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
}
