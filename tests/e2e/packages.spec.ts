import { test, expect, Page } from '@playwright/test'
import { setOwnerAuth } from './helpers/auth'
import { toLocalDateStr } from './helpers/dates'

// ─── B4a: Paquetes prepagados ──────────────────────────────────────────────────
// Contra el stack real (bypass de auth, negocio mimosnails).
//
// TEST ACTIVO — catálogo + venta:
//   1. Crear un producto de paquete en /dashboard/paquetes (3 sesiones, aplica a todos).
//   2. Entrar al detalle de una clienta y venderle el paquete → "3 sesiones restantes".
//
// TEST fixme — consumo en reserva (pasos 3-4):
//   El wizard de reserva manual (/dashboard/bookings/new) + la verificación del consumo
//   resultó frágil en e2e sobre este entorno: el pool pgbouncer de dev corre con
//   connection_limit=1, así que cada render/mutación del detalle de clienta tarda ~15-21s
//   (getCustomerLoyalty corre su tx interactiva serial antes de las lecturas), y la
//   revalidación de la venta a veces excede la ventana; además la clienta seed es
//   compartida y acumula reservas/paquetes de corridas previas (colisión de slots,
//   consumo FIFO sobre otro paquete). El flujo pasó de punta a punta 2 de 3 veces → no es
//   estable. El CONSUMO ya está cubierto de forma determinista por integración contra un
//   Postgres real: tests/integration/packages-consume.test.ts (applyPackageInTx: descuento
//   total, flip a redeemed, agotamiento, compra vencida) y packages-actions.test.ts
//   (sellPackage, getActivePackagesForCustomer). Reactivar cuando el detalle de clienta sea
//   rápido/estable localmente (pool con más conexiones) y el test tenga clienta dedicada.

async function gotoStable(page: Page, path: string, attempts = 4): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      return
    } catch (e) {
      const msg = String(e)
      if (i < attempts - 1 && /ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|Timeout/i.test(msg)) {
        await page.waitForTimeout(1_500); continue
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
  await page.getByLabel('Hora hora').selectOption(hour.padStart(2, '0'))
  await page.getByLabel('Hora minutos').selectOption(minute.padStart(2, '0'))
}

/** Panel "Paquetes" del detalle de clienta (studio-card cuyo <h3> es "Paquetes"). */
function packagePanel(page: Page) {
  return page.locator('div.studio-card').filter({
    has: page.getByRole('heading', { name: 'Paquetes', level: 3 }),
  })
}

/** Suma las "N sesiones restantes" de TODAS las filas de paquete del panel. */
async function totalRemainingSessions(page: Page): Promise<number> {
  const rows = await packagePanel(page).locator('li', { hasText: /sesiones restantes/ }).allInnerTexts()
  return rows.reduce((sum, text) => {
    const m = text.match(/(\d+)\s+sesiones restantes/)
    return sum + (m ? Number(m[1]) : 0)
  }, 0)
}

/**
 * Crea un producto de paquete "Pack e2e <ts>" (3 sesiones, aplica a todos, vence en 30d) y
 * verifica su fila en el catálogo. Devuelve el nombre único para targetear filas después.
 */
async function createPackageProduct(page: Page): Promise<string> {
  const packName = `Pack e2e ${Date.now()}`
  await gotoStable(page, '/dashboard/paquetes')
  await waitForHydration(page)

  const catalog = page.locator('section', { hasText: 'Catálogo de paquetes' })
  await expect(catalog).toBeVisible()

  const createForm = catalog.locator('form')
  await createForm.locator('input[name="name"]').fill(packName)
  await createForm.locator('input[name="quantity"]').fill('3')
  await createForm.locator('input[name="price"]').fill('30000')
  await createForm.locator('input[name="expiryDays"]').fill('30')
  // "Aplica a todos los servicios" viene marcado por default; lo dejamos así.
  await expect(createForm.locator('input[name="appliesToAll"]')).toBeChecked()
  await createForm.getByRole('button', { name: 'Crear paquete' }).click()

  // El producto recién creado aparece en la lista del catálogo (fila por nombre único).
  const productRow = catalog.locator('li', { hasText: packName })
  await expect(productRow).toBeVisible({ timeout: 15_000 })
  await expect(productRow).toContainText('3')
  await expect(productRow).toContainText('Todos los servicios')
  return packName
}

/**
 * Entra al detalle de la primera clienta de la lista y devuelve { href, name, panel }.
 * La lista renderiza cards (mobile, md:hidden) y una tabla (desktop); en el viewport
 * desktop de Playwright solo la tabla es visible, así que filtramos por links visibles
 * para no agarrar la card oculta.
 */
async function openFirstCustomerDetail(page: Page): Promise<{ href: string; name: string }> {
  await gotoStable(page, '/dashboard/customers')
  await waitForHydration(page)

  const firstCustomerLink = page.locator('a[href^="/dashboard/customers/"]:visible').first()
  await expect(firstCustomerLink).toBeVisible({ timeout: 15_000 })
  const href = await firstCustomerLink.getAttribute('href')
  expect(href).toBeTruthy()
  await gotoStable(page, href!)
  await waitForHydration(page)

  const name = (await page.getByRole('heading', { level: 1 }).first().innerText()).trim()
  expect(name.length).toBeGreaterThan(0)
  expect(name).not.toMatch(/Algo salió mal/i)
  return { href: href!, name }
}

test.describe('Paquetes prepagados', () => {
  test('crear producto de paquete + venderlo a una clienta', async ({ page }) => {
    // Catálogo + venta. El detalle de clienta es lento en el pool chico de dev
    // (connection_limit=1): el render inicial y la revalidación de la venta tardan
    // ~15-21s cada uno, así que damos margen y polleamos la fila resultante.
    test.setTimeout(120_000)
    setOwnerAuth(page)

    // ── Paso 1: crear el producto ─────────────────────────────────────────────
    const packName = await createPackageProduct(page)

    // ── Paso 2: vender el paquete a una clienta ───────────────────────────────
    await openFirstCustomerDetail(page)

    const panel = packagePanel(page)
    await expect(panel).toBeVisible({ timeout: 15_000 })

    // Seleccionar el producto recién creado en el <select> y vender. El <option>
    // renderiza "Pack e2e <ts> — $30.000"; seleccionamos por su value (id).
    const sellForm = panel.locator('form', { hasText: 'Vender paquete' })
    await expect(sellForm).toBeVisible()
    const productOption = sellForm.locator('select option', { hasText: packName })
    await expect(productOption).toHaveCount(1, { timeout: 10_000 })
    const productOptionValue = await productOption.getAttribute('value')
    expect(productOptionValue).toBeTruthy()
    await sellForm.locator('select').selectOption(productOptionValue!)
    await sellForm.getByRole('button', { name: 'Vender' }).click()

    // La venta corre por server action + revalidatePath del detalle; en el pool chico esa
    // revalidación es lenta (la page re-corre getCustomerLoyalty serial). Polleamos la fila
    // de la compra hasta que muestre las 3 sesiones restantes (más resiliente que una única
    // espera de visibilidad ante la latencia variable del pool de una sola conexión).
    const purchaseRow = panel.locator('li', { hasText: packName })
    await expect(async () => {
      await expect(purchaseRow).toBeVisible()
      await expect(purchaseRow).toContainText('3 sesiones restantes')
    }).toPass({ timeout: 45_000 })
  })

  // ── Consumo en reserva (pasos 3-4) — fixme, ver nota de cabecera ─────────────
  // Frágil en e2e (pool chico + wizard + clienta seed compartida). Consumo cubierto por
  // tests/integration/packages-consume.test.ts. Reactivar cuando el detalle de clienta sea
  // estable localmente y el test use una clienta dedicada (sin estado acumulado).
  test.fixme('venta + consumo en reserva manual (consumo cubierto por integración)', async ({ page }) => {
    test.setTimeout(150_000)
    setOwnerAuth(page)

    const packName = await createPackageProduct(page)
    const { href: customerHref, name: customerName } = await openFirstCustomerDetail(page)

    // Vender.
    const panel = packagePanel(page)
    const sellForm = panel.locator('form', { hasText: 'Vender paquete' })
    const productOption = sellForm.locator('select option', { hasText: packName })
    const productOptionValue = await productOption.getAttribute('value')
    await sellForm.locator('select').selectOption(productOptionValue!)
    await sellForm.getByRole('button', { name: 'Vender' }).click()

    const purchaseRow = panel.locator('li', { hasText: packName })
    await expect(async () => {
      await expect(purchaseRow).toBeVisible()
      await expect(purchaseRow).toContainText('3 sesiones restantes')
    }).toPass({ timeout: 45_000 })

    // Total de sesiones activas ANTES (baseline del invariante de consumo).
    const remainingBefore = await totalRemainingSessions(page)
    expect(remainingBefore).toBeGreaterThanOrEqual(3)

    // Reserva manual que consume el paquete.
    await gotoStable(page, '/dashboard/bookings/new')
    await waitForHydration(page)
    const serviceSelect = page.locator('select#serviceId')
    await expect(serviceSelect).toBeVisible({ timeout: 15_000 })
    const serviceOptionValue = await serviceSelect.locator('option').nth(1).getAttribute('value')
    await serviceSelect.selectOption(serviceOptionValue!)

    await expect(async () => {
      const searchBox = page.getByPlaceholder('Buscar por nombre o teléfono...')
      await searchBox.fill('')
      await searchBox.fill(customerName)
      const suggestion = page.getByRole('button').filter({ hasText: customerName }).first()
      await expect(suggestion).toBeVisible({ timeout: 3_000 })
      await suggestion.click()
    }).toPass({ timeout: 20_000 })
    await expect(page.locator('input#customerName')).toHaveValue(customerName, { timeout: 10_000 })

    // Fecha/hora aleatorias (weekday, 09:00-15:45) para no chocar con reservas confirmadas
    // de corridas previas sobre la clienta seed (el server rechaza slots solapados).
    const d = new Date()
    d.setDate(d.getDate() + 10 + Math.floor(Math.random() * 25))
    const dow = d.getDay()
    if (dow === 6) d.setDate(d.getDate() + 2)
    else if (dow === 0) d.setDate(d.getDate() + 1)
    const dateStr = toLocalDateStr(d)
    const hour = 9 + Math.floor(Math.random() * 7)
    const minute = [0, 15, 30, 45][Math.floor(Math.random() * 4)]
    await page.locator('input#date').fill(dateStr)
    await selectDashboardTime(page, `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)

    const packageToggle = page.locator('label', { hasText: 'Usar paquete' })
    await expect(packageToggle).toBeVisible({ timeout: 15_000 })
    await expect(packageToggle.locator('input[type="checkbox"]')).toBeChecked()

    await page.getByRole('button', { name: 'Crear reserva' }).click()
    await expect(page.getByText('Reserva creada')).toBeVisible({ timeout: 20_000 })

    // El total de sesiones activas de la clienta bajó EXACTAMENTE en 1.
    await gotoStable(page, customerHref)
    await waitForHydration(page)
    await expect(packagePanel(page).locator('li', { hasText: packName })).toBeVisible({ timeout: 15_000 })
    await expect(async () => {
      expect(await totalRemainingSessions(page)).toBe(remainingBefore - 1)
    }).toPass({ timeout: 20_000 })
  })
})
