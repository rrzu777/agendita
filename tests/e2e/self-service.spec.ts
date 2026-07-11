import { test, expect, Page } from '@playwright/test'
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

function selectDashboardTime(page: Page, time: string): Promise<void> {
  const [hour, minute] = time.split(':')
  return (async () => {
    await page.getByLabel('Hora hora').selectOption(hour.padStart(2, '0'))
    await page.getByLabel('Hora minutos').selectOption(minute.padStart(2, '0'))
  })()
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

    // 3. Ubicar la fila de la reserva recién creada en "Próximas reservas" por
    //    su fecha corta (único identificador visible en la tarjeta de /mi).
    const upcomingSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Próximas reservas' }) })
    const bookingRow = upcomingSection.locator('li').filter({ hasText: dateLabel }).first()
    await expect(bookingRow).toBeVisible({ timeout: 15_000 })

    // La reserva está a >48h y selfServiceCutoffHours por defecto es 24 →
    // BookingActions debe renderizar ambas acciones.
    await expect(bookingRow.getByRole('link', { name: 'Reprogramar' })).toBeVisible()
    await expect(bookingRow.getByRole('button', { name: 'Cancelar reserva' })).toBeVisible()

    // 4. Cancelar con confirmación inline.
    await bookingRow.getByRole('button', { name: 'Cancelar reserva' }).click()
    await bookingRow.getByRole('button', { name: 'Sí, cancelar' }).click()

    // 5. La fila desaparece de "Próximas reservas"...
    await expect(bookingRow).toHaveCount(0, { timeout: 15_000 })

    // ...y reaparece en "Historial" como "Cancelada".
    const historialSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Historial' }) })
    const historialRow = historialSection.locator('li').filter({ hasText: dateLabel }).first()
    await expect(historialRow).toBeVisible({ timeout: 15_000 })
    await expect(historialRow).toContainText('Cancelada')
  })
})
