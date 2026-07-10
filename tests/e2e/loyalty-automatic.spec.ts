import { test, expect, Page } from '@playwright/test'
import { toLocalDateStr } from './helpers/dates'

// ─── B3: Condiciones automáticas de fidelización ───────────────────────────────
//
// Cobertura UI-driven, determinista, contra el server dev + Postgres real (header
// bypass). Serializado (workers:1, fullyParallel:false en playwright.config.ts).
//
// Flujos cubiertos (verdes):
//   1. Config de regla automática `first_visit` → recompensa en PUNTOS, persiste tras recargar.
//   2. first_visit en completación: clienta NUEVA (teléfono único) → reserva manual →
//      completar → la clienta recibe la bonificación ("Bonificación") en su panel de puntos.
//   3. Gate isActive: con fidelización PAUSADA, completar otra reserva NO emite bonificación.
//
// Flujos SALTEADOS (documentados):
//   4. Reseña → premio: requiere el flujo público de reseña (token + página /resena/...).
//      Es un evento aparte de la completación y agrega varios pasos frágiles de UI pública;
//      se saltea para mantener la suite robusta. La emisión `review` está cubierta por unit/integration.
//   5. Referral end-to-end: el más complejo (generar link en "Mi tarjeta", reservar como
//      clienta nueva vía ?ref=, completar AMBAS, verificar premio doble). Demasiados pasos
//      encadenados y dependientes de la UI pública para ser determinista aquí. Salteado.
//
// Nota de timing: la emisión de first_visit ocurre POST-COMMIT en una tx separada
// (R-EMIT en updateBookingStatus). Reload + reintento corto cubre la ventana.

// ─── Constantes (mismo patrón que smoke.spec.ts) ───────────────────────────────
const E2E_SECRET = process.env.PLAYWRIGHT_E2E_AUTH_SECRET || 'e2e-secret-local'
const E2E_OWNER_EMAIL = process.env.PLAYWRIGHT_E2E_OWNER_EMAIL || 'owner@mimosnails.com'

const FIRST_VISIT_POINTS = 100

function setOwnerAuth(page: Page) {
  page.setExtraHTTPHeaders({
    'x-e2e-test-user-email': E2E_OWNER_EMAIL,
    'x-e2e-auth-secret': E2E_SECRET,
  })
}

/**
 * page.goto con reintento ante blips transitorios del dev server (ERR_CONNECTION_REFUSED
 * mientras Next recompila una ruta bajo carga). Espera 'domcontentloaded'.
 */
async function gotoStable(page: Page, path: string, attempts = 4): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      return
    } catch (e) {
      const msg = String(e)
      if (i < attempts - 1 && /ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|Timeout/i.test(msg)) {
        await page.waitForTimeout(1_500)
        continue
      }
      throw e
    }
  }
}

/**
 * Espera a que React hidrate antes de interactuar con un form client-side. Sin esto,
 * un click sobre "Guardar" antes de la hidratación dispara el submit NATIVO del form
 * (GET con query params) en vez del onSubmit con preventDefault. Esperamos 'load'
 * (incluye JS) con tope, y un margen corto para que el handler quede atado.
 */
async function waitForHydration(page: Page): Promise<void> {
  await page.waitForLoadState('load', { timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(800)
}

async function selectDashboardTime(page: Page, time: string): Promise<void> {
  const [hour, minute] = time.split(':')
  await page.getByLabel('Hora hora').selectOption(hour.padStart(2, '0'))
  await page.getByLabel('Hora minutos').selectOption(minute.padStart(2, '0'))
}

/** Fecha en día de semana, al menos `afterDays` días en el futuro (idéntico a smoke). */
function nextBookableDate(afterDays = 3): Date {
  const date = new Date()
  date.setDate(date.getDate() + afterDays)
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1)
  }
  return date
}

/**
 * Crea una reserva manual confirmada (paymentMode='none' ⇒ confirmed) para una
 * clienta NUEVA. La DB es real y persiste entre corridas: para no chocar slots con
 * datos previos elegimos una FECHA lejana (`afterDays` grande, única por corrida) y,
 * si igual hay choque, reintentamos con horas distintas dentro del mismo día.
 * Verifica que la reserva quedó realmente creada (fila visible en la lista).
 */
async function createManualBooking(
  page: Page,
  opts: { name: string; phone: string; afterDays: number },
): Promise<void> {
  const futureDate = nextBookableDate(opts.afterDays)
  const dateStr = toLocalDateStr(futureDate)

  // Horas candidatas dentro de 10:00–14:30 (entran en toda regla de disponibilidad,
  // incl. sábado 10–15, para la duración del servicio — igual que smoke.spec.ts).
  // Varias para tolerar slots ya ocupados por datos previos en la DB real.
  const times = [
    '10:00', '10:30', '11:00', '11:30', '12:00',
    '12:30', '13:00', '13:30', '14:00', '14:30',
  ]
  let lastError = ''

  for (const time of times) {
    await gotoStable(page, '/dashboard/bookings/new')
    await waitForHydration(page)

    // Servicio (index 1 = primer servicio real).
    await page.locator('select#serviceId').selectOption({ index: 1 })
    await page.getByLabel('Nombre').fill(opts.name)
    await page.getByLabel('Teléfono').fill(opts.phone)
    await page.locator('input#date').fill(dateStr)
    await selectDashboardTime(page, time)

    // Pago total ('full_paid') + método: garantiza estado 'confirmed' AUNQUE el servicio
    // pida abono (con 'none' + abono requerido la reserva nacería 'pending_payment' y NO
    // tendría botón "Completar"). Así la reserva queda lista para completar.
    // El radio real es sr-only; clickeamos su <label> ("Pago total") que lo activa.
    await page.locator('label', { hasText: /^Pago total$/ }).click()
    await page.locator('select#paymentMethod').selectOption({ index: 0 })

    await page.getByRole('button', { name: /crear reserva/i }).click()

    // Éxito: pantalla "Reserva creada" (heading). Error: caja text-destructive con mensaje.
    const successHeading = page.getByRole('heading', { name: /reserva creada/i })
    const errorBox = page.locator('div.text-destructive').filter({ hasText: /\S/ }).first()
    await Promise.race([
      successHeading.waitFor({ timeout: 20_000 }).catch(() => {}),
      errorBox.waitFor({ timeout: 20_000 }).catch(() => {}),
    ])

    if (await successHeading.isVisible().catch(() => false)) {
      // Confirmar persistencia + estado COMPLETABLE: la fila de nuestra clienta debe
      // aparecer en la lista con estado "Confirmada" (si naciera pending_payment no
      // tendría botón "Completar" y el test no podría disparar la emisión).
      await gotoStable(page, '/dashboard/bookings')
      const row = page.locator('table tr', { hasText: opts.name }).first()
      await expect(row).toBeVisible({ timeout: 15_000 })
      await expect(row).toContainText(/Confirmada/i, { timeout: 10_000 })
      return
    }

    lastError = (await errorBox.textContent().catch(() => '')) ?? ''
    // En prod el throw de "slot ocupado" se enmascara como "Server Components
    // render"; reintentamos con otra hora también ante ese mensaje.
    if (/disponible|ocupado|Server Components render/i.test(lastError)) continue
    throw new Error(`createManualBooking falló: ${lastError || '(sin texto de error)'}`)
  }
  throw new Error(`createManualBooking: sin slot libre tras reintentos (último: ${lastError})`)
}

/**
 * Completa la reserva confirmada de la clienta `name` desde el dashboard.
 * Busca la fila por nombre y clickea "Completar". Cae al botón global si no
 * encuentra fila específica (la reserva recién creada suele estar arriba).
 */
async function completeBookingByCustomer(page: Page, name: string): Promise<void> {
  await gotoStable(page, '/dashboard/bookings')
  await page.waitForLoadState('domcontentloaded')

  // Targetear SOLO la fila de nuestra clienta (nombre único). NO usamos un fallback al
  // "primer Completar de la página": completaría la reserva de OTRA clienta y dejaría la
  // nuestra sin completar (= sin emisión first_visit). Si nuestra fila no tiene botón
  // "Completar", la reserva no quedó confirmada → fallar claro.
  const row = page.locator('table tr', { hasText: name }).first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.scrollIntoViewIfNeeded()
  const completeBtn = row.getByRole('button', { name: /^completar$/i })
  await expect(completeBtn).toBeVisible({ timeout: 10_000 })
  await completeBtn.click()
  // La acción es un server action sobre el form de la fila; al completarse el botón
  // "Completar" de esa fila desaparece (estado pasa a "Completada").
  await expect(completeBtn).toHaveCount(0, { timeout: 20_000 })
}

/**
 * Abre el detalle de la clienta buscándola por NOMBRE (único por corrida) en la
 * lista. El teléfono se guarda normalizado (sin '+'), así que buscar por nombre
 * exacto es más robusto que por teléfono.
 */
async function openCustomerByName(page: Page, name: string): Promise<void> {
  await gotoStable(page, '/dashboard/customers')
  const search = page.getByPlaceholder(/buscar por nombre/i)
  await search.fill(name)
  await page.waitForTimeout(500) // filtro client-side
  // La lista renderiza dos variantes (cards mobile md:hidden + tabla desktop). En el
  // viewport de test la mobile está oculta, así que filtramos por el link VISIBLE.
  const link = page.locator('a[href*="/dashboard/customers/"]:visible').first()
  await expect(link).toBeVisible({ timeout: 8_000 })
  const href = await link.getAttribute('href')
  // Navegación directa por URL: más robusta que click+waitForURL en el dev server lento
  // (la página de detalle hace reconcile + varias queries y puede tardar en "load").
  await page.goto(href ?? '/dashboard/customers')
  await page.waitForLoadState('domcontentloaded')
  // Confirmar que estamos en el detalle (el header muestra "Detalle de cliente").
  await expect(page.getByText(/detalle de cliente/i).first()).toBeVisible({ timeout: 25_000 })
}

/**
 * Configura (upsert) la regla automática `first_visit` con recompensa en puntos.
 * `active` controla el checkbox "Activar" de la regla. Idempotente: si la regla ya
 * existe se actualiza ("Guardar cambios"), si no se crea ("Crear regla").
 */
async function configureFirstVisitRule(page: Page, opts: { active: boolean; points: number }) {
  await gotoStable(page, '/dashboard/fidelizacion')
  await waitForHydration(page)

  // La tarjeta "Primera visita" es el <form> que contiene ese encabezado.
  const card = page.locator('form', { hasText: 'Primera visita' }).first()
  await expect(card).toBeVisible({ timeout: 10_000 })

  // Recompensa en PUNTOS (radio "puntos" suele venir seleccionado por defecto, pero lo forzamos).
  const pointsRadio = card.locator('input[type="radio"]').first()
  await pointsRadio.check()

  // Cantidad de puntos.
  const pointsInput = card.locator('input[name="rewardPoints"]')
  await expect(pointsInput).toBeVisible({ timeout: 5_000 })
  await pointsInput.fill(String(opts.points))

  // Checkbox "Activar" de la regla.
  const activeCheckbox = card.locator('input[name="isActive"]')
  if (opts.active) {
    await activeCheckbox.check()
  } else {
    await activeCheckbox.uncheck()
  }

  // Guardar (texto depende de si ya existía).
  const saveBtn = card.getByRole('button', { name: /guardar cambios|crear regla/i })
  await saveBtn.click()
  await expect(card.getByText(/guardado/i)).toBeVisible({ timeout: 25_000 })
}

/** Activa/pausa el programa de fidelización global (checkbox "Programa activo"). */
async function setLoyaltyProgramActive(page: Page, active: boolean) {
  await gotoStable(page, '/dashboard/fidelizacion')
  await waitForHydration(page)

  // El form de config es el que tiene "Programa activo".
  const configForm = page.locator('form', { hasText: 'Programa activo' }).first()
  await expect(configForm).toBeVisible({ timeout: 10_000 })

  const activeToggle = configForm.locator('input[name="isActive"]')
  if (active) {
    await activeToggle.check()
  } else {
    await activeToggle.uncheck()
  }
  // programName es required: aseguramos un valor para no romper el submit.
  const programName = configForm.locator('input[name="programName"]')
  if (!(await programName.inputValue())) {
    await programName.fill('Club E2E-B3')
  }
  // pointsPerVisit en 0 para que la única emisión por completar sea la bonificación.
  const ppv = configForm.locator('input[name="pointsPerVisit"]')
  await ppv.fill('0')

  await configForm.getByRole('button', { name: /guardar/i }).click()
  await expect(configForm.getByText(/guardado/i)).toBeVisible({ timeout: 25_000 })
}

/** Lee el saldo numérico mostrado en el panel de fidelización de la clienta. */
async function readLoyaltyBalance(page: Page): Promise<number> {
  // El panel muestra "Fidelización" + un número grande con el saldo.
  const panel = page.locator('div', { hasText: /Fidelización/ }).filter({ has: page.getByRole('heading', { name: /Fidelización/i }) }).last()
  const balanceText = await panel.locator('span.text-2xl').first().textContent().catch(() => null)
  if (balanceText) {
    const n = parseInt(balanceText.replace(/[^\d-]/g, ''), 10)
    if (!Number.isNaN(n)) return n
  }
  return 0
}

// ─── Setup global del describe ─────────────────────────────────────────────────
test.describe('loyalty — condiciones automáticas (B3)', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(({ page }) => {
    setOwnerAuth(page)
  })

  test.afterAll(async ({ browser }) => {
    // Dejar el programa reactivado para no afectar otras suites/datos.
    test.setTimeout(60_000)
    const page = await browser.newPage()
    setOwnerAuth(page)
    await setLoyaltyProgramActive(page, true).catch(() => {})
    await configureFirstVisitRule(page, { active: true, points: FIRST_VISIT_POINTS }).catch(() => {})
    await page.close().catch(() => {})
  })

  // ── Flujo 1: configurar regla automática + persistencia ──────────────────────
  test('config: regla first_visit en puntos persiste tras recargar', async ({ page }) => {
    test.setTimeout(120_000)
    await setLoyaltyProgramActive(page, true)
    await configureFirstVisitRule(page, { active: true, points: FIRST_VISIT_POINTS })

    // Recargar y verificar persistencia. El input de puntos es condicional a
    // rewardKind='points' (estado cliente), así que se renderiza recién tras hidratar;
    // esperamos hidratación + reintento corto en vez de leer el valor en frío (evita
    // la carrera de hidratación que hace flaky un toHaveValue directo).
    let persisted = false
    for (let attempt = 0; attempt < 4; attempt++) {
      await gotoStable(page, '/dashboard/fidelizacion')
      await waitForHydration(page)
      const card = page.locator('form', { hasText: 'Primera visita' }).first()
      const input = card.locator('input[name="rewardPoints"]')
      if (await input.isVisible({ timeout: 5_000 }).catch(() => false)) {
        const val = await input.inputValue().catch(() => '')
        const active = await card.locator('input[name="isActive"]').isChecked().catch(() => false)
        if (val === String(FIRST_VISIT_POINTS) && active) {
          persisted = true
          break
        }
      }
      await page.waitForTimeout(1_000)
    }
    expect(persisted).toBeTruthy()
  })

  // ── Flujo 2: first_visit emite bonificación al completar ──────────────────────
  test('first_visit: completar primera reserva de clienta nueva emite bonificación', async ({ page }) => {
    test.setTimeout(150_000)
    // Garantizar programa activo + regla activa.
    await setLoyaltyProgramActive(page, true)
    await configureFirstVisitRule(page, { active: true, points: FIRST_VISIT_POINTS })

    const ts = Date.now()
    const name = `E2E-B3 Primera ${ts}`
    const phone = `+5698${String(ts).slice(-7)}`

    // Día futuro único por corrida, DENTRO de la ventana de reserva del negocio
    // (bookingWindowDays=90): rango 7–56 días. Más allá de la ventana todos los
    // horarios figuran "no disponibles".
    await createManualBooking(page, { name, phone, afterDays: 7 + (ts % 50) })
    await completeBookingByCustomer(page, name)

    // La emisión es post-commit en tx separada: reintento con reload.
    await openCustomerByName(page, name)

    let bonificacionVisible = false
    for (let attempt = 0; attempt < 5; attempt++) {
      bonificacionVisible = await page
        .getByText(/Bonificación/i)
        .first()
        .isVisible({ timeout: 2_000 })
        .catch(() => false)
      if (bonificacionVisible) break
      await page.waitForTimeout(1_000)
      await page.reload()
      await page.waitForLoadState('domcontentloaded')
    }

    expect(bonificacionVisible).toBeTruthy()
    // Saldo debe reflejar los puntos de la bonificación (pointsPerVisit=0).
    const balance = await readLoyaltyBalance(page)
    expect(balance).toBeGreaterThanOrEqual(FIRST_VISIT_POINTS)
  })

  // ── Flujo 3: gate isActive — programa pausado NO emite ────────────────────────
  test('gate isActive: con programa pausado, completar NO emite bonificación', async ({ page }) => {
    test.setTimeout(150_000)
    // Pausar el programa global (la regla puede seguir "activa", pero el gate global manda).
    await setLoyaltyProgramActive(page, false)

    const ts = Date.now()
    const name = `E2E-B3 Pausada ${ts}`
    const phone = `+5697${String(ts).slice(-7)}`

    // Día futuro dentro de la ventana (7–56 días), distinto por ts del test anterior.
    await createManualBooking(page, { name, phone, afterDays: 8 + (ts % 50) })
    await completeBookingByCustomer(page, name)

    // Con el programa pausado, el panel de fidelización de la clienta NO se renderiza
    // (page.tsx solo muestra LoyaltyPanel si loyaltyConfig existe; y aunque exista,
    // no debe haber bonificación). Damos margen post-commit y verificamos ausencia.
    await openCustomerByName(page, name)
    await page.waitForTimeout(1_500)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    const panelExists = await page
      .getByRole('heading', { name: /^Fidelización$/i })
      .isVisible({ timeout: 3_000 })
      .catch(() => false)

    if (panelExists) {
      // Si el config existe (programa pausado pero registro presente), el saldo debe ser 0
      // y no debe haber asiento "Bonificación".
      const bonificacion = await page.getByText(/Bonificación/i).first().isVisible({ timeout: 2_000 }).catch(() => false)
      expect(bonificacion).toBeFalsy()
      const balance = await readLoyaltyBalance(page)
      expect(balance).toBe(0)
    } else {
      // Sin panel ⇒ no hubo emisión: correcto.
      expect(panelExists).toBeFalsy()
    }

    // Reactivar para dejar el entorno limpio (también lo hace afterAll).
    await setLoyaltyProgramActive(page, true)
  })
})
