import { test, expect, Page, Locator } from '@playwright/test'
import { setOwnerAuth, setAdminAuth } from './helpers/auth'
import { toLocalDateStr } from './helpers/dates'

// ─── Task 12: e2e smoke de cancelación self-service (/mi) ─────────────────────
//
// Misma estrategia que customer-account.spec.ts (Task 14 de D1-a), que
// establece por qué la dueña NO sirve de "clienta": el guard de miembros
// (code review D1-a) bloquea a owner/staff de auto-vincularse Customers de su
// propio negocio. Usamos la identidad del platform admin (admin@agendita.cl),
// que tiene fila User pero NO membresía en mimosnails:
//
//   1. Como dueña (bypass owner): crear, vía el form real de "Nueva reserva",
//      una Customer con el email del admin + una reserva manual CONFIRMADA
//      (modo "Pago total") a >48h de distancia — dentro del bookingWindowDays
//      del negocio (mismo rango 4..53 días que usa customer-account.spec.ts).
//   2. Como admin: visitar /mi → auto-link vía email en prepareMiUser() →
//      entrar al negocio → la reserva aparece en "Próximas reservas" con las
//      acciones self-service (selfServiceCutoffHours=24 por defecto, la
//      reserva está a >48h → BookingActions debe mostrar "Reprogramar" y
//      "Cancelar reserva").
//   3. Cancelar (confirmación inline "Sí, cancelar") → la fila desaparece de
//      "Próximas reservas" y reaparece en "Historial" como "Cancelada".
//
// Si la fila User del admin no existe en la DB target, el bypass no puede
// fabricar la sesión y /mi redirige a /ingresar → el test se salta (skip) en
// runtime en vez de dar un rojo falso (mismo guard que customer-account.spec.ts).

/**
 * page.goto con reintento ante blips transitorios del dev server (mismo patrón
 * que customer-account.spec.ts / loyalty-automatic.spec.ts).
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

async function waitForHydration(page: Page): Promise<void> {
  await page.waitForLoadState('load', { timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(800)
}

async function selectDashboardTime(page: Page, time: string): Promise<void> {
  const [hour, minute] = time.split(':')
  await page.getByLabel('Hora', { exact: true }).click()
  const picker = page.getByRole('dialog').last()
  await picker.getByRole('button', { name: hour.padStart(2, '0'), exact: true }).first().click()
  await picker.getByRole('button', { name: minute.padStart(2, '0'), exact: true }).last().click()
  await picker.getByRole('button', { name: 'Aplicar', exact: true }).click()
}

/** Fecha en día de semana, al menos `afterDays` días en el futuro. */
function nextBookableDate(afterDays: number): Date {
  const date = new Date()
  date.setDate(date.getDate() + afterDays)
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1)
  }
  return date
}

/** Mismo formato que src/lib/format-date.ts#formatShortDate, para matchear la fila en /mi. */
function shortDateLabel(date: Date): string {
  return new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short' }).format(date)
}

/**
 * Localiza, entre varias filas de reserva, la que corresponde a la que este test
 * acaba de crear, y devuelve un locator que apunta SÓLO a ella.
 *
 * Por qué hace falta: la fecha no identifica una fila. `afterDays` es aleatorio en
 * una ventana de 50 días (`4 + ts % 50`) sobre una DB compartida que nadie limpia,
 * así que dos corridas pueden caer en el mismo día; y una corrida que falló deja su
 * reserva confirmada en "Próximas reservas" para siempre, envenenando esa fecha.
 * Con `.first()` + `toHaveCount(0)` eso da un falso rojo: cancelás una fila y la
 * otra sigue matcheando.
 *
 * La tarjeta muestra además el número de reserva (`#4738`), que sí es único. El
 * contador es por negocio y sólo crece (ver assignBookingNumber), así que entre
 * las candidatas la recién creada es la de número más alto.
 */
async function rowOfNewestBooking(rows: Locator): Promise<{ row: Locator; matcher: RegExp }> {
  const textos = await rows.allTextContents()
  const numeros = textos
    .map((t) => t.match(/#(\d+)/)?.[1])
    .filter((n): n is string => n != null)
    .map(Number)

  // Tirar y no devolver un matcher vacío: `filter({ hasText: '' })` matchea TODAS
  // las filas y las aserciones pasarían sin probar nada.
  if (numeros.length === 0) {
    throw new Error(`Ninguna fila expone un número de reserva. Filas: ${textos.join(' | ') || '(ninguna)'}`)
  }

  // Devolvemos el regex, no el string: `hasText` con string hace substring, así que
  // #123 matchearía #1234. El `(?!\d)` lo evita, y sirve igual en Historial, donde
  // conviven muchas reservas viejas.
  const matcher = new RegExp(`#${Math.max(...numeros)}(?!\\d)`)
  return { row: rows.filter({ hasText: matcher }), matcher }
}

/**
 * Crea, vía el form de "Nueva reserva" del dashboard, una Customer nueva con
 * email=ADMIN_EMAIL y una reserva CONFIRMADA (paymentMode="Pago total", no
 * depende de si el servicio tiene abono configurado) a `afterDays` días de
 * distancia. Devuelve la fecha efectivamente usada, para localizar la fila en
 * /mi por su fecha corta ("dd mon").
 */
async function createConfirmedBookingWithAdminEmail(
  page: Page,
  opts: { name: string; phone: string; email: string; afterDays: number },
): Promise<Date> {
  const futureDate = nextBookableDate(opts.afterDays)
  const dateStr = toLocalDateStr(futureDate)

  const times = [
    '10:00', '10:30', '11:00', '11:30', '12:00',
    '12:30', '13:00', '13:30', '14:00', '14:30',
  ]
  let lastError = ''

  for (const time of times) {
    await gotoStable(page, '/dashboard/bookings/new')
    await waitForHydration(page)

    await page.locator('select#serviceId').selectOption({ index: 1 })
    await page.getByLabel('Nombre *').fill(opts.name)
    await page.getByLabel('Teléfono *').fill(opts.phone)
    await page.getByLabel('Email (opcional)').fill(opts.email)
    await page.locator('input#date').fill(dateStr)
    await selectDashboardTime(page, time)

    // Forzar estado "confirmed" (independiente de si el servicio elegido
    // requiere abono): modo "Pago total".
    await page.locator('label', { hasText: 'Pago total' }).click()

    await page.getByRole('button', { name: /crear reserva/i }).click()

    const successHeading = page.getByRole('heading', { name: /reserva creada/i })
    const errorBox = page.locator('div.text-destructive').filter({ hasText: /\S/ }).first()
    await Promise.race([
      successHeading.waitFor({ timeout: 20_000 }).catch(() => {}),
      errorBox.waitFor({ timeout: 20_000 }).catch(() => {}),
    ])

    if (await successHeading.isVisible().catch(() => false)) {
      return futureDate
    }

    lastError = (await errorBox.textContent().catch(() => '')) ?? ''
    // En prod el throw de "slot ocupado" se enmascara como "Server Components
    // render"; reintentamos con otra hora también ante ese mensaje.
    if (/disponible|ocupado|Server Components render/i.test(lastError)) continue
    throw new Error(`createConfirmedBookingWithAdminEmail falló: ${lastError || '(sin texto de error)'}`)
  }
  throw new Error(`createConfirmedBookingWithAdminEmail: sin slot libre tras reintentos (último: ${lastError})`)
}

test.describe('self-service (/mi): cancelación', () => {
  test('cancelar una reserva próxima la mueve a Historial como Cancelada', async ({ page }) => {
    test.setTimeout(90_000)
    setOwnerAuth(page)

    const ADMIN_EMAIL = process.env.PLAYWRIGHT_E2E_ADMIN_EMAIL || 'admin@agendita.cl'
    const ts = Date.now()
    const name = `E2E Self-Service ${ts}`
    const phone = `+5698${String(ts).slice(-7)}`

    // 1. Como dueña: crear una Customer + reserva confirmada en mimosnails con
    //    el email del admin, a >48h (afterDays>=4) y dentro del
    //    bookingWindowDays del negocio (mismo rango que customer-account.spec.ts).
    const bookingDate = await createConfirmedBookingWithAdminEmail(page, {
      name, phone, email: ADMIN_EMAIL, afterDays: 4 + (ts % 50),
    })
    const dateLabel = shortDateLabel(bookingDate)

    // 2. Cambiar a la sesión del admin y visitar /mi → ensureUserRow + auto-link.
    setAdminAuth(page)
    await gotoStable(page, '/mi')
    if (page.url().includes('/ingresar')) {
      test.skip(true, 'La fila User del admin no existe en la DB target — el bypass no puede fabricar la sesión')
    }

    const businessLink = page.locator('a[href^="/mi/"]').filter({ hasText: /\S/ }).first()
    await expect(businessLink).toBeVisible({ timeout: 15_000 })
    const href = await businessLink.getAttribute('href')
    await gotoStable(page, href ?? '/mi')
    await waitForHydration(page)

    // 3. Ubicar la fila de la reserva recién creada en "Próximas reservas": primero
    //    por fecha corta, y entre las candidatas por su número de reserva, que es el
    //    único identificador unívoco de la tarjeta (ver rowOfNewestBooking).
    const upcomingSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Próximas reservas' }) })
    const rowsForDate = upcomingSection.locator('li').filter({ hasText: dateLabel })
    await expect(rowsForDate.first()).toBeVisible({ timeout: 15_000 })

    const { row: bookingRow, matcher: bookingMatcher } = await rowOfNewestBooking(rowsForDate)
    await expect(bookingRow).toHaveCount(1)

    // La reserva está a >48h y selfServiceCutoffHours por defecto es 24 →
    // BookingActions debe renderizar ambas acciones.
    await expect(bookingRow.getByRole('link', { name: 'Reprogramar' })).toBeVisible()
    await expect(bookingRow.getByRole('button', { name: 'Cancelar reserva' })).toBeVisible()

    // 4. Cancelar con confirmación inline.
    await bookingRow.getByRole('button', { name: 'Cancelar reserva' }).click()
    await bookingRow.getByRole('button', { name: 'Sí, cancelar' }).click()

    // 5. La fila desaparece de "Próximas reservas"...
    //    Ahora es exacto: el locator apunta a ESA reserva por su número, así que una
    //    fila ajena que comparta la fecha no puede mantener el conteo en 1.
    await expect(bookingRow).toHaveCount(0, { timeout: 15_000 })

    // ...y reaparece en "Historial" como "Cancelada".
    const historialSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Historial' }) })
    const historialRow = historialSection.locator('li').filter({ hasText: bookingMatcher }).first()
    await expect(historialRow).toBeVisible({ timeout: 15_000 })
    await expect(historialRow).toContainText('Cancelada')
  })
})
