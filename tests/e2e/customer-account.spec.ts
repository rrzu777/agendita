import { test, expect, Page } from '@playwright/test'
import { setOwnerAuth } from './helpers/auth'

// ─── Task 14: e2e de /mi (cuenta de clienta) ───────────────────────────────────
//
// Estrategia sin seed nuevo: el bypass e2e (`setOwnerAuth`) resuelve un Prisma
// `User` existente por email (owner@mimosnails.com) y ahora fabrica un usuario
// sintético CON `email_confirmed_at` (Paso 1 de esta tarea), lo que habilita
// `isVerifiedEmail()` → el layout de /mi corre `linkCustomersByVerifiedEmail`.
//
// Para ejercer el auto-link creamos (vía el form real de "Nueva reserva" del
// dashboard) una Customer con email=owner@mimosnails.com. Esa Customer con
// userId=null queda disponible para el auto-link la próxima vez que la dueña
// visite /mi. Esto también cubre el rol dual dueña+clienta.
//
// Idempotente: si una corrida previa ya vinculó una Customer con ese email,
// /mi ya mostrará el negocio sin necesitar crear una nueva — igual creamos una
// (nombre único por timestamp) para que la aserción no dependa de estado previo:
// ambas (la vieja y la nueva) matchean por email y se linkean; /mi muestra el
// negocio de todas formas.

/**
 * page.goto con reintento ante blips transitorios del dev server (mismo patrón
 * que loyalty-automatic.spec.ts).
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
function nextBookableDate(afterDays = 3): Date {
  const date = new Date()
  date.setDate(date.getDate() + afterDays)
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1)
  }
  return date
}

/**
 * Crea, vía el form de "Nueva reserva" del dashboard, una Customer nueva con
 * email=OWNER_EMAIL (dejando así una fila de Customer con userId=null y ese
 * email, lista para el auto-link de /mi). No hace falta completar la reserva:
 * basta con que la Customer quede persistida.
 */
async function createCustomerWithOwnerEmail(
  page: Page,
  opts: { name: string; phone: string; email: string; afterDays: number },
): Promise<void> {
  const futureDate = nextBookableDate(opts.afterDays)
  const dateStr = futureDate.toISOString().split('T')[0]

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

    await page.getByRole('button', { name: /crear reserva/i }).click()

    const successHeading = page.getByRole('heading', { name: /reserva creada/i })
    const errorBox = page.locator('div.text-destructive').filter({ hasText: /\S/ }).first()
    await Promise.race([
      successHeading.waitFor({ timeout: 20_000 }).catch(() => {}),
      errorBox.waitFor({ timeout: 20_000 }).catch(() => {}),
    ])

    if (await successHeading.isVisible().catch(() => false)) {
      return
    }

    lastError = (await errorBox.textContent().catch(() => '')) ?? ''
    if (/disponible|ocupado/i.test(lastError)) continue // slot tomado: probar otra hora
    throw new Error(`createCustomerWithOwnerEmail falló: ${lastError || '(sin texto de error)'}`)
  }
  throw new Error(`createCustomerWithOwnerEmail: sin slot libre tras reintentos (último: ${lastError})`)
}

test.describe('cuenta de clienta (/mi)', () => {
  test('auto-link por email y tarjeta visible en /mi', async ({ page }) => {
    test.setTimeout(90_000)
    setOwnerAuth(page)

    const OWNER_EMAIL = process.env.PLAYWRIGHT_E2E_OWNER_EMAIL || 'owner@mimosnails.com'
    const ts = Date.now()
    const name = `E2E Cuenta ${ts}`
    const phone = `+5699${String(ts).slice(-7)}`

    // 1. Asegurar que exista una Customer con email=OWNER_EMAIL en mimosnails.
    //    Creamos una nueva (nombre único) en vez de depender de una corrida previa:
    //    tanto si ya había una vinculada como si no, /mi debe mostrar el negocio.
    await createCustomerWithOwnerEmail(page, { name, phone, email: OWNER_EMAIL, afterDays: 4 + (ts % 50) })

    // 2. Visitar /mi → el layout corre ensureUserRow + auto-link por email verificado.
    await gotoStable(page, '/mi')

    // Tarjeta del negocio (Mimos Nails) visible en "Mis negocios".
    const businessLink = page.locator('a[href^="/mi/"]').filter({ hasText: /\S/ }).first()
    await expect(businessLink).toBeVisible({ timeout: 15_000 })

    // 3. Abrir el detalle → secciones de la tarjeta de fidelización.
    const href = await businessLink.getAttribute('href')
    await gotoStable(page, href ?? '/mi')
    await expect(page.getByRole('heading', { name: 'Historial' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Próximas reservas' })).toBeVisible()
  })

  test('/dashboard sigue funcionando para la dueña (dual rol)', async ({ page }) => {
    setOwnerAuth(page)
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/dashboard/)
  })
})
