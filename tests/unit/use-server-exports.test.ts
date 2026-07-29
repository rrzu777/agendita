import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { findUseServerModules, lineOf } from '../helpers/use-server-modules'

/**
 * Guard de CI para el borde `'use server'`.
 *
 * Next transforma TODO lo que exporta un módulo con la directiva en una
 * referencia de servidor, y al arrancar valida cada una:
 *
 *   A "use server" file can only export async functions, found <typeof>.
 *
 * (`next/dist/build/webpack/loaders/next-flight-loader/action-validate.js`,
 * verificado contra la versión instalada). Un export que no sea función no
 * rompe el build: rompe en RUNTIME, y no cuando se usa ese export sino cuando
 * se ejecuta CUALQUIER action del módulo. Ya pasó dos veces —una con un schema
 * de Zod re-exportado (PR #6), otra con un `export type {…}` que dejó una
 * referencia a un tipo borrado y tiró 500 al guardar la configuración
 * (PR #16)—. Las dos veces se descubrió en producción, porque ni `tsc` ni el
 * build dicen nada.
 *
 * Next trae una regla equivalente (`server-boundary`) pero es un plugin del
 * language service de TypeScript: corre en el editor, no en CI. Regla de ESLint
 * no hay. Por eso este test.
 *
 * Lo que SÍ está permitido, y no es obvio:
 *
 * - `export const f = action(_f)` — un `export const` está bien mientras
 *   EVALÚE a función. El patrón HOF es el que usa medio `src/server/actions`.
 * - `export type X = {…}` / `export interface X {…}` — declaraciones puras que
 *   TypeScript borra antes de que la transformación las vea. Hay cinco vivas en
 *   producción hoy. Lo que rompió en PR #16 fue el re-export (`export type { X }`),
 *   que es otra cosa y sigue prohibido acá.
 */

/**
 * HOFs que devuelven una función. La lista es explícita a propósito: sin ella
 * habría que aceptar cualquier `CallExpression`, y `export const schema =
 * z.object({})` es un `CallExpression` igual que `action(_f)` — o sea que el
 * guard dejaría pasar exactamente el bug de PR #6. Distinguirlos de verdad
 * necesita el type checker (un `ts.createProgram` sobre todo el repo, segundos
 * en vez de milisegundos).
 *
 * Sumar una entrada acá es una decisión deliberada: si aparece un HOF nuevo el
 * test falla y alguien tiene que confirmar que devuelve una función.
 */
const FUNCTION_RETURNING_HOFS = new Set(['action'])

const isFunctionLike = (node: ts.Expression): boolean =>
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node) ||
  (ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    FUNCTION_RETURNING_HOFS.has(node.expression.text))

/** Devuelve un renglón por cada export que no evalúe a función. */
function findOffendingExports(sourceFile: ts.SourceFile, relPath: string): string[] {
  const offenders: string[] = []
  const flag = (node: ts.Node, what: string) =>
    offenders.push(`${relPath}:${lineOf(sourceFile, node)} — ${what}`)

  for (const st of sourceFile.statements) {
    // `export { x }`, `export type { x }`, `export * from './y'`: la
    // indirección impide probar que sea función, y el re-export de tipo es
    // exactamente lo que tiró 500 en PR #16. Importá el símbolo de su módulo
    // puro en vez de re-exportarlo desde acá.
    if (ts.isExportDeclaration(st)) {
      flag(st, 'export/re-export indirecto: importá el símbolo de su módulo puro')
      continue
    }
    if (ts.isExportAssignment(st)) {
      flag(st, 'export default')
      continue
    }

    const exported = ts.getModifiers(st as ts.HasModifiers)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    if (!exported) continue

    // Declaraciones de tipo: TypeScript las borra, no llegan al runtime.
    if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) continue

    if (ts.isFunctionDeclaration(st)) {
      const isAsync = ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
      if (!isAsync) flag(st, `export function ${st.name?.text} no es async`)
      continue
    }

    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const name = ts.isIdentifier(d.name) ? d.name.text : '<destructuring>'
        if (!d.initializer || !isFunctionLike(d.initializer)) {
          flag(d, `export const ${name} no evalúa a función`)
        }
      }
      continue
    }

    flag(st, `export de ${ts.SyntaxKind[st.kind]}`)
  }

  return offenders
}

const check = (source: string): string[] =>
  findOffendingExports(
    ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true),
    'fixture.ts',
  )

describe('borde use server: todo export debe evaluar a función', () => {
  const modules = findUseServerModules()

  it('encuentra los módulos con la directiva (y no los que la tienen inline)', () => {
    expect(modules.length).toBeGreaterThan(20)
    expect(modules.map((m) => m.relPath)).toContain('src/server/actions/bookings.ts')
    // Tiene 'use server' adentro de una función, no arriba del archivo.
    expect(modules.map((m) => m.relPath)).not.toContain('src/app/mi/layout.tsx')
  })

  it('ningún módulo exporta algo que no sea una función', () => {
    const offenders = modules.flatMap(({ relPath, sourceFile }) => findOffendingExports(sourceFile, relPath))
    expect(offenders).toEqual([])
  })

  // Sin estos casos el guard podría estar apagado y nadie se enteraría: un
  // detector que dejó de detectar no falla, deja de reportar.
  it('caza cada forma que rompe en runtime', () => {
    expect(check("export const schema = z.object({})")).toHaveLength(1)
    expect(check("export const HOLD_HOURS = 24")).toHaveLength(1)
    expect(check("export const STATUSES = ['a', 'b'] as const")).toHaveLength(1)
    expect(check("export type { Foo }")).toHaveLength(1)   // el 500 de PR #16
    expect(check("export { helper } from './helper'")).toHaveLength(1)
    expect(check("export * from './otro'")).toHaveLength(1)
    expect(check('export default schema')).toHaveLength(1)
    expect(check('export enum Estado { a }')).toHaveLength(1)
    expect(check('export class Svc {}')).toHaveLength(1)
    expect(check('export function noAsync() {}')).toHaveLength(1)
    // Un HOF desconocido no se asume función: `z.object({})` es una llamada
    // igual que `action(_f)`, y esa confusión es el bug de PR #6.
    expect(check('export const leer = cache(async () => {})')).toHaveLength(1)
  })

  it('deja pasar lo que sí es válido', () => {
    expect(check('export async function crear() {}')).toEqual([])
    // El default sí puede ser una función: el validador de Next sólo mira
    // `typeof === 'function'`, no de qué forma se exportó.
    expect(check('export default async function crear() {}')).toEqual([])
    expect(check('export const crear = action(_crear)')).toEqual([])
    expect(check('export const borrar = async () => {}')).toEqual([])
    expect(check('export type Fila = { id: string }')).toEqual([])
    expect(check('export interface Entrada { id: string }')).toEqual([])
    expect(check('const privado = 3')).toEqual([])
  })
})
