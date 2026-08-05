import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { findUseClientModules } from '../helpers/use-client-modules'

type ClockCall = {
  relPath: string
  line: number
  sourceLine: string
}

const CLIENT_ONLY_CALLBACKS = new Set(['useEffect', 'useLayoutEffect'])

function calleeName(node: ts.CallExpression): string | null {
  if (ts.isIdentifier(node.expression)) return node.expression.text
  if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text
  return null
}

function isFunctionLike(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
}

/**
 * Un callback inline de efecto o evento no participa del HTML inicial: corre
 * después de hidratar o por una interacción. El resto se trata como render-time
 * de forma conservadora; incluye helpers del módulo llamados por el componente.
 */
function isInsideKnownClientOnlyCallback(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (!isFunctionLike(current)) continue

    const parent: ts.Node = current.parent
    if (ts.isCallExpression(parent) && parent.arguments.includes(current)) {
      const name = calleeName(parent)
      if (name && CLIENT_ONLY_CALLBACKS.has(name)) return true
    }

    if (
      ts.isJsxExpression(parent) &&
      parent.expression === current &&
      ts.isJsxAttribute(parent.parent) &&
      /^on[A-Z]/.test(parent.parent.name.getText())
    ) {
      return true
    }
  }
  return false
}

function lineText(sourceFile: ts.SourceFile, node: ts.Node): string {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return sourceFile.text.split(/\r?\n/)[line].trim().replace(/\s+/g, ' ')
}

/** Relojes implícitos que pueden producir HTML distinto entre SSR e hidratación. */
function findRenderClockCalls(sourceFile: ts.SourceFile, relPath: string): ClockCall[] {
  const calls: ClockCall[] = []

  const visit = (node: ts.Node) => {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Date' &&
      (node.arguments?.length ?? 0) === 0 &&
      !isInsideKnownClientOnlyCallback(node)
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      calls.push({ relPath, line: line + 1, sourceLine: lineText(sourceFile, node) })
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return calls
}

const fingerprint = ({ relPath, sourceLine }: ClockCall) => `${relPath} — ${sourceLine}`

/**
 * Casos deliberados de granularidad día/mes. La clave incluye el código para
 * que borrar un uso permitido y agregar otro peligroso en el mismo archivo no
 * conserve el cupo por accidente.
 */
const ALLOWED_RENDER_CLOCKS = new Map<string, string>([
  [
    "src/app/dashboard/bookings/[id]/reschedule/reschedule-form.tsx — const today = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd')",
    'fecha mínima para reprogramar; sólo cambia a medianoche',
  ],
  [
    "src/app/dashboard/bookings/new/new-booking-form.tsx — const today = getLocalDateStr(new Date(), timezone)",
    'fecha mínima del formulario; sólo cambia a medianoche',
  ],
  [
    'src/app/dashboard/bookings/new/new-booking-form.tsx — <Input id="customerBirthDate" type="date" max={new Date().toISOString().slice(0, 10)} value={customerBirthDate} onChange={(e) => setCustomerBirthDate(e.target.value)} className="h-10" />',
    'máximo del input de nacimiento; sólo cambia a medianoche',
  ],
  [
    'src/app/dashboard/customers/[id]/edit-form.tsx — max={new Date().toISOString().slice(0, 10)}',
    'máximo del input de nacimiento; sólo cambia a medianoche',
  ],
  [
    'src/app/dashboard/customers/customer-list.tsx — const today = new Date()',
    'filtro de clientas recientes; granularidad diaria',
  ],
  [
    'src/app/mi/[slug]/reservas/[bookingId]/reprogramar/reprogramar-form.tsx — const today = formatInTimeZone(new Date(), timezone, \'yyyy-MM-dd\')',
    'fecha mínima para reprogramar; sólo cambia a medianoche',
  ],
  [
    'src/components/booking/step-customer.tsx — <Input className="studio-input" type="date" max={new Date().toISOString().slice(0, 10)}',
    'máximo del input de nacimiento; sólo cambia a medianoche',
  ],
  [
    'src/components/booking/step-date.tsx — const [currentMonth, setCurrentMonth] = useState(new Date())',
    'mes inicial del calendario; sólo cambia al cambiar de mes',
  ],
  [
    'src/components/booking/step-date.tsx — const businessToday = getLocalDateStr(new Date(), timezone)',
    'día mínimo del calendario; sólo cambia a medianoche',
  ],
  [
    'src/components/dashboard/export-csv-button.tsx — const now = new Date()',
    'rango inicial del CSV; sólo cambia al cambiar de mes',
  ],
])

const check = (source: string): ClockCall[] => {
  const sourceFile = ts.createSourceFile('fixture.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  return findRenderClockCalls(sourceFile, 'fixture.tsx')
}

describe("reloj durante render de módulos 'use client'", () => {
  const modules = findUseClientModules()

  it('encuentra los módulos cliente reales', () => {
    expect(modules.length).toBeGreaterThan(20)
    expect(modules.map(({ relPath }) => relPath)).toContain('src/components/booking/step-date.tsx')
  })

  it('no agrega relojes implícitos sin una decisión explícita', () => {
    const calls = modules.flatMap(({ sourceFile, relPath }) => findRenderClockCalls(sourceFile, relPath))
    const actual = new Set(calls.map(fingerprint))
    const unexpected = calls
      .filter((call) => !ALLOWED_RENDER_CLOCKS.has(fingerprint(call)))
      .map(({ relPath, line, sourceLine }) => `${relPath}:${line} — ${sourceLine}`)
    const missing = [...ALLOWED_RENDER_CLOCKS.keys()].filter((allowed) => !actual.has(allowed))

    expect(unexpected).toEqual([])
    expect(missing).toEqual([])
    expect([...ALLOWED_RENDER_CLOCKS.values()].every((reason) => reason.length > 0)).toBe(true)
  })

  it('caza las formas que pueden cambiar entre SSR e hidratación', () => {
    expect(check("'use client'; function Card() { const now = new Date(); return <p>{now.toISOString()}</p> }")).toHaveLength(1)
    expect(check("'use client'; function Card() { const now = useMemo(() => new Date(), []); return <p>{String(now)}</p> }")).toHaveLength(1)
    expect(check("'use client'; function Card() { const [now] = useState(() => new Date()); return <p>{String(now)}</p> }")).toHaveLength(1)
    expect(check("'use client'; function now() { return new Date() } function Card() { return <p>{String(now())}</p> }")).toHaveLength(1)
  })

  it('deja pasar relojes deterministas y callbacks que sólo corren en cliente', () => {
    expect(check("'use client'; const fixed = new Date('2026-08-04T00:00:00Z')")).toEqual([])
    expect(check("'use client'; function Card() { useEffect(() => { void new Date() }, []); return null }")).toEqual([])
    expect(check("'use client'; function Card() { return <button onClick={() => void new Date()}>Ahora</button> }")).toEqual([])
  })
})
