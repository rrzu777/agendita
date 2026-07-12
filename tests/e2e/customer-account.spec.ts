import { test, expect, Page } from '@playwright/test'
import { setOwnerAuth, setAdminAuth } from './helpers/auth'
import { toLocalDateStr } from './helpers/dates'

// ─── Task 14: e2e de /mi (cuenta de clienta) ───────────────────────────────────
//
// Estrategia sin seed nuevo: el bypass e2e resuelve un Prisma `User` existente
// por email y fabrica un usuario sintético CON `email_confirmed_at`, lo que
// habilita `isVerifiedEmail()` → el layout de /mi corre
// `linkCustomersByVerifiedEmail`.
//
// IMPORTANTE (guard de miembros, code review D1-a): owner/staff NO pueden
// vincularse Customers de su propio negocio — así que la dueña ya no sirve de
// "clienta" en mimosnails. Usamos la identidad del platform admin
// (admin@agendita.cl), que tiene fila User pero NO membresía en mimosnails:
// la dueña crea (form real de "Nueva reserva") una Customer con el email del
// admin, y luego la sesión admin visita /mi → auto-link.
//
// Si la fila User del admin no existe en la DB target, el bypass no puede
// fabricar la sesión y /mi redirige a /ingresar → el test se salta (skip) en
// runtime en vez de dar un rojo falso.
//
// Idempotente: creamos una Customer nueva (nombre único por timestamp) en cada
// corrida; tanto si una corrida previa ya vinculó otra con ese email como si
// no, /mi debe mostrar el negocio.

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

async function selectDashboardTime(page: Page, time: string): Promise<void> {
  const [hour, minute] = time.split(':')
  await page.getByLabel('Hora', { exact: true }).click()
  const picker = page.getByRole('dialog').last()
  await picker.getByRole('button', { name: hour.padStart(2, '0'), exact: true }).first().click()
  await picker.getByRole('button', { name: minute.padStart(2, '0'), exact: true }).last().click()
  await picker.getByRole('button', { name: 'Aplicar', exact: true }).click()
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
    // En prod el throw de "slot ocupado" se enmascara como "Server Components
    // render"; reintentamos con otra hora también ante ese mensaje.
    if (/disponible|ocupado|Server Components render/i.test(lastError)) continue
    throw new Error(`createCustomerWithOwnerEmail falló: ${lastError || '(sin texto de error)'}`)
  }
  throw new Error(`createCustomerWithOwnerEmail: sin slot libre tras reintentos (último: ${lastError})`)
}

test.describe('cuenta de clienta (/mi)', () => {
  test('auto-link por email y tarjeta visible en /mi', async ({ page }) => {
    test.setTimeout(90_000)
    setOwnerAuth(page)

    const ADMIN_EMAIL = process.env.PLAYWRIGHT_E2E_ADMIN_EMAIL || 'admin@agendita.cl'
    const ts = Date.now()
    const name = `E2E Cuenta ${ts}`
    const phone = `+5699${String(ts).slice(-7)}`

    // 1. Como dueña: crear una Customer en mimosnails con el email del admin
    //    (identidad "clienta" sin membresía — el guard de miembros bloquea a la
    //    dueña de auto-vincularse clientas propias).
    await createCustomerWithOwnerEmail(page, { name, phone, email: ADMIN_EMAIL, afterDays: 4 + (ts % 50) })

    // 2. Cambiar a la sesión del admin y visitar /mi → ensureUserRow + auto-link.
    setAdminAuth(page)
    await gotoStable(page, '/mi')
    if (page.url().includes('/ingresar')) {
      test.skip(true, 'La fila User del admin no existe en la DB target — el bypass no puede fabricar la sesión')
    }

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
