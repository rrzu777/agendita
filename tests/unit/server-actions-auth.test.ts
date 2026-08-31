import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { findUseServerModules, calleeName, lineOf } from '../helpers/use-server-modules'

/**
 * Guard de CI: toda server action, o pide sesión, o está declarada pública acá.
 *
 * Un módulo `'use server'` publica cada uno de sus exports como endpoint
 * invocable por cualquiera con un POST. No hay routing, no hay middleware, no
 * hay nada entre internet y esa función: el único control de acceso es el que
 * la función misma haga. Olvidarse es silencioso — el código anda perfecto
 * desde el dashboard, donde siempre hay sesión.
 *
 * Ya pasó: la auditoría de arquitectura encontró una action de borrado sin
 * ningún guard (arreglada en #109), y este mismo test encontró
 * `createBusinessForUser`, exportada desde `lib/auth/actions.ts` con `userId` y
 * `email` arbitrarios y sin sesión — se movió a `lib/business/create-for-user.ts`,
 * un módulo sin directiva, así que dejó de ser un endpoint.
 *
 * Este test NO decide si una action puede ser pública: decide que la respuesta
 * esté ESCRITA. Muchas de las de abajo tienen que ser anónimas —la clienta que
 * reserva no tiene cuenta—, y cada una se defiende con lo suyo (un token, el
 * teléfono, saber el id de la reserva, un rate limit). Lo que no puede pasar es
 * que una action quede sin sesión por descuido y nadie lo note.
 */

/** Guards que cortan la ejecución si no hay sesión/permiso. */
const AUTH_GUARDS = new Set([
  'requireUser',
  'requireBusiness',
  'requireBusinessRole',
  'requirePlatformAdmin',
  'requirePlatformAdminUser',
])

/**
 * Actions deliberadamente anónimas, con el motivo. Agregar una entrada acá es
 * afirmar que la function se defiende sola — no es un pase libre.
 */
const PUBLICAS: Record<string, string> = {
  // --- Autenticación: son el camino PARA obtener sesión, exigirla sería circular.
  'src/lib/auth/actions.ts#signIn': 'es el login',
  'src/lib/auth/actions.ts#signUp': 'es el registro',
  'src/lib/auth/actions.ts#signInWithGoogle': 'arranca el OAuth',
  'src/lib/auth/actions.ts#signOut': 'cerrar sesión sin sesión es no-op',
  'src/lib/auth/actions.ts#requestPasswordReset': 'recuperar contraseña es anónimo por diseño',
  'src/lib/auth/actions.ts#updatePassword':
    'actúa sobre la sesión del link de recuperación (supabase.auth.updateUser); no recibe a quién cambiarle la contraseña',
  'src/lib/auth/actions.ts#checkSubdomainAvailability': 'disponibilidad de subdominio durante el registro',
  'src/server/actions/recover-business.ts#recoverBusiness':
    'valida la sesión a mano con supabase.auth.getUser() porque corre justo cuando la fila User todavía no existe y requireUser fallaría',

  // --- Funnel público de reserva: la clienta no tiene cuenta.
  'src/server/actions/availability.ts#getAvailableTimeSlots':
    'el calendario público; rate limit por IP y sólo responde de negocios activos',
  'src/server/actions/availability.ts#getAvailableTimeSlotsResult':
    'adapter diagnóstico del mismo calendario público: delega en _getAvailableTimeSlots con idéntico rate limit y validación de negocio/servicio/profesional',
  'src/server/actions/bookings.ts#createBooking': 'reservar es todo el punto del funnel público',
  'src/server/actions/promotions.ts#previewPromotion':
    'preview NO autoritativa del wizard (la validación real va en createBooking); rate limit propio',
  'src/server/actions/packages.ts#getActivePackagesForCustomer':
    'el wizard consulta saldo de paquete por teléfono; devuelve sólo un contador, rate limit propio',

  // --- Pago de la clienta sobre su propia reserva: autoriza conocer el id.
  'src/server/actions/payments.ts#initiatePayment': 'la clienta anónima paga su reserva; rate limit',
  'src/server/actions/payments.ts#verifyAndConfirmPayment': 'vuelta del proveedor de pago, sin sesión; rate limit',
  'src/server/actions/payments.ts#getOnlinePaymentAvailability':
    'sólo dice si el negocio tiene pago online activo — es lo mismo que ve cualquiera en la página pública',

  // --- Transferencia bancaria declarada por la clienta.
  'src/server/actions/bank-transfer-public.ts#getBankTransferInfo':
    'son los datos bancarios que el negocio publica a propósito para que le transfieran',
  'src/server/actions/bank-transfer-public.ts#createProofUploadUrl':
    'la URL prefirmada queda atada al bookingId; rate limit y tipo de archivo validado',
  'src/server/actions/bank-transfer-public.ts#declareBankTransfer': 'la clienta avisa que pagó el abono; rate limit',
  'src/server/actions/bank-transfer-public.ts#declareBalanceTransfer': 'la clienta avisa que pagó el saldo; rate limit',
  'src/server/actions/bank-transfer-public.ts#attachProof': 'adjunta el comprobante a lo ya declarado',

  // --- Compra pública de paquetes: mismo modelo que reservar.
  'src/server/actions/packages-checkout.ts#createPackagePurchase': 'comprar un paquete no exige cuenta',
  'src/server/actions/packages-checkout.ts#getPackageCheckoutPrefill': 'prellenado del checkout público',
  'src/server/actions/packages-checkout.ts#initiatePackagePayment': 'pago del paquete recién comprado',
  'src/server/actions/packages-checkout.ts#verifyAndConfirmPackagePayment': 'vuelta del proveedor de pago',
  'src/server/actions/packages-checkout.ts#declarePackageTransfer': 'la clienta avisa que transfirió el paquete',

  // --- Links de email: el token ES la autorización.
  'src/server/actions/reviews.ts#getReviewRequest': 'compara reviewToken antes de devolver nada',
  'src/server/actions/reviews.ts#submitReview': 'compara reviewToken; rate limit',
  'src/server/actions/loyalty.ts#redeemPointsAsCustomer': 'el loyaltyToken de la tarjeta identifica a la clienta',
  'src/server/actions/marketing-optout.ts#setMarketingOptOutByToken': 'baja desde el link del email; autoriza el token',
}

/**
 * Índice nombre → cuerpo de las funciones del archivo, con `const x = action(_x)`
 * ya resuelto a `_x`. Sin esa resolución toda action envuelta parecería no tener
 * guard, porque el guard vive en la función interna.
 */
function indexLocals(sf: ts.SourceFile): Map<string, ts.Node> {
  const locals = new Map<string, ts.Node>()
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) locals.set(st.name.text, st)
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) locals.set(d.name.text, d.initializer)
      }
    }
  }
  for (const [name, node] of [...locals]) {
    if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const arg = node.arguments[0]
      if (ts.isIdentifier(arg) && locals.has(arg.text)) locals.set(name, locals.get(arg.text)!)
    }
  }
  return locals
}

/**
 * ¿El cuerpo llama a un guard? Sigue las llamadas a funciones del mismo archivo
 * hasta 3 niveles, porque varias actions delegan el guard en un helper local
 * (`loadDeclaredPayment`, `assertSeriesOwned`). No cruza archivos: el guard
 * tiene que estar a la vista de quien lee la action.
 */
function callsAuthGuard(node: ts.Node | undefined, locals: Map<string, ts.Node>, seen = new Set<string>(), depth = 0): boolean {
  if (!node || depth > 3) return false
  let found = false
  const visit = (n: ts.Node) => {
    if (found) return
    if (ts.isCallExpression(n)) {
      const name = calleeName(n)
      if (name && AUTH_GUARDS.has(name)) {
        found = true
        return
      }
      if (name && locals.has(name) && !seen.has(name)) {
        seen.add(name)
        if (callsAuthGuard(locals.get(name), locals, seen, depth + 1)) {
          found = true
          return
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return found
}

/** `[clave, línea]` de cada action exportada que no llama a ningún guard. */
function findUnguardedExports(sf: ts.SourceFile, relPath: string): Array<[string, number]> {
  const locals = indexLocals(sf)
  const out: Array<[string, number]> = []

  const consider = (name: string, body: ts.Node | undefined, at: ts.Node) => {
    if (!callsAuthGuard(body, locals)) out.push([`${relPath}#${name}`, lineOf(sf, at)])
  }

  for (const st of sf.statements) {
    const exported = ts.getModifiers(st as ts.HasModifiers)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    if (!exported) continue

    if (ts.isFunctionDeclaration(st) && st.name) {
      consider(st.name.text, st, st)
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue
        consider(d.name.text, locals.get(d.name.text) ?? d.initializer, d)
      }
    }
  }
  return out
}

const check = (source: string): string[] =>
  findUnguardedExports(ts.createSourceFile('f.ts', source, ts.ScriptTarget.Latest, true), 'f.ts').map(([k]) => k)

describe('toda server action pide sesión o está declarada pública', () => {
  const modules = findUseServerModules()

  it('no hay ninguna action sin guard ni declarada', () => {
    const sinDeclarar = modules
      .flatMap(({ relPath, sourceFile }) => findUnguardedExports(sourceFile, relPath))
      .filter(([key]) => !(key in PUBLICAS))
      .map(([key, line]) => `${key} (línea ${line})`)

    expect(sinDeclarar).toEqual([])
  })

  it('la lista de públicas no acumula entradas muertas', () => {
    const reales = new Set(
      modules.flatMap(({ relPath, sourceFile }) => findUnguardedExports(sourceFile, relPath)).map(([key]) => key),
    )
    // Si una entrada sobra es porque la action ganó un guard, se renombró o
    // desapareció: en cualquier caso el motivo escrito ya no describe nada.
    expect(Object.keys(PUBLICAS).filter((key) => !reales.has(key))).toEqual([])
  })

  it('detecta la action sin guard y no se confunde con las que sí lo tienen', () => {
    expect(check('export async function borrarTodo() { await prisma.x.deleteMany() }')).toEqual(['f.ts#borrarTodo'])
    expect(check('export async function ok() { const { businessId } = await requireBusiness() }')).toEqual([])

    // El guard vive adentro de la función que envuelve `action()`.
    expect(
      check(`
        async function _crear() { await requireBusinessRole(['owner']) }
        export const crear = action(_crear)
      `),
    ).toEqual([])
    expect(
      check(`
        async function _crear() { await prisma.x.create({}) }
        export const crear = action(_crear)
      `),
    ).toEqual(['f.ts#crear'])

    // Y puede estar un nivel más abajo, en un helper del mismo archivo.
    expect(
      check(`
        async function cargar() { await requireBusiness() }
        export async function leer() { await cargar() }
      `),
    ).toEqual([])
  })
})
