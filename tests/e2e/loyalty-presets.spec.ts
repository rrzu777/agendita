import { test, expect, Page } from '@playwright/test'

// ─── B-onboarding: Presets de fidelización ─────────────────────────────────────
// Aplica el combo "Programa recomendado" y verifica que siembre config + canje, y
// que re-aplicar sea idempotente (no duplica el canje). Contra el stack real (bypass).

const E2E_SECRET = process.env.PLAYWRIGHT_E2E_AUTH_SECRET || 'e2e-secret-local'
const E2E_OWNER_EMAIL = process.env.PLAYWRIGHT_E2E_OWNER_EMAIL || 'owner@mimosnails.com'

function setOwnerAuth(page: Page) {
  page.setExtraHTTPHeaders({ 'x-e2e-test-user-email': E2E_OWNER_EMAIL, 'x-e2e-auth-secret': E2E_SECRET })
}

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

/** Card del picker cuyo título coincide con `name`. */
function presetCard(page: Page, name: string) {
  return page.locator('div.rounded-lg.border', { hasText: name }).first()
}

/**
 * Filas del catálogo de canje cuyo NOMBRE es exactamente `name`. El texto "Servicio
 * gratis" también aparece como <option> en varios <select> (tipo de recompensa del
 * form de canje y de la regla de Cumpleaños), así que un getByText global cuenta de
 * más. Nos anclamos al <span class="font-medium"> que es el nombre de la recompensa,
 * dentro de la sección "Catálogo de canje".
 */
function redemptionRowsNamed(page: Page, name: string) {
  return page
    .locator('section', { hasText: 'Catálogo de canje' })
    .locator('li span.font-medium', { hasText: new RegExp(`^${name}$`) })
}

test.describe('Presets de fidelización', () => {
  test('aplicar "Programa recomendado" siembra config + canje, idempotente', async ({ page }) => {
    setOwnerAuth(page)
    await gotoStable(page, '/dashboard/fidelizacion')
    await waitForHydration(page)

    const card = presetCard(page, 'Programa recomendado')
    await card.getByRole('button', { name: 'Aplicar' }).click()
    await card.getByRole('button', { name: 'Confirmar' }).click()
    await expect(card.getByText(/Se encendió/i).first()).toBeVisible({ timeout: 15_000 })

    await gotoStable(page, '/dashboard/fidelizacion')
    await waitForHydration(page)

    await expect(async () => {
      const label = await page.locator('#pointsLabel-choice').inputValue()
      expect(label).toBe('sellos')
      const perVisit = await page.locator('input[name="pointsPerVisit"]').inputValue()
      expect(perVisit).toBe('1')
    }).toPass({ timeout: 15_000 })

    await expect(redemptionRowsNamed(page, 'Servicio gratis')).toHaveCount(1)

    const bdayCard = page.locator('form', { hasText: 'Cumpleaños' }).first()
    await expect(bdayCard.locator('input[name="isActive"]')).toBeChecked()

    const card2 = presetCard(page, 'Programa recomendado')
    await card2.getByRole('button', { name: 'Aplicar' }).click()
    await card2.getByRole('button', { name: 'Confirmar' }).click()
    // Al re-aplicar, el resumen muestra "Se encendió: …" (el config siempre se escribe)
    // y también "Ya tenías: …" para lo ya sembrado (2 <p>). Anclamos al de "Se encendió",
    // que confirma que la acción corrió; el .first evita el strict-mode con 2 párrafos.
    await expect(card2.getByText(/Se encendió/i).first()).toBeVisible({ timeout: 15_000 })
    await expect(card2.getByText(/Ya tenías/i)).toBeVisible({ timeout: 15_000 })

    await gotoStable(page, '/dashboard/fidelizacion')
    await waitForHydration(page)
    await expect(redemptionRowsNamed(page, 'Servicio gratis')).toHaveCount(1)
  })
})
