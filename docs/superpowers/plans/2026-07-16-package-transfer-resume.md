# Retomar transferencia de paquete abandonada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la clienta pueda retomar una compra de paquete por transferencia abandonada (confirmation activa + revive de expiradas + recordatorios + visibilidad en /mi), espejo del flujo que ya tienen las reservas.

**Architecture:** Enfoque "rama por superficie" (espejo de B4b-3): cada superficie existente gana su rama de paquete sin unificar la maquinaria booking/paquete. Spec aprobado: `docs/superpowers/specs/2026-07-16-package-transfer-resume-design.md`.

**Tech Stack:** Next.js (App Router, server actions), Prisma/Postgres, Vitest, React (component tests con renderToStaticMarkup).

**Reglas de sesión que aplican a TODO el plan:**
- Worktree: `/Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52`, rama `claude/package-transfer-resume`. El cwd del shell puede driftear: **siempre `git -C <worktree>`** y `git add` con archivos explícitos (nunca `-A`).
- `tsc` no corre en vitest/lint: el gate final corre `npx prisma generate && npx tsc --noEmit | grep '^src/'` (0 errores).
- Component tests que rendericen algo con `useRouter()` **deben mockear `next/navigation`**.
- PR **sin auto-merge**: se mergea solo con OK explícito del usuario.
- Colisión con la otra sesión (rama C): `src/lib/notifications/email-provider.ts` es compartido — agregar los senders nuevos **al final del archivo** (append-only).

---

## Mapa de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `prisma/schema.prisma` + migración nueva | Modify | 2 flags de recordatorio en `PackagePurchase` |
| `src/server/actions/packages-checkout.ts` | Modify | marcar `paymentMethod` al crear/reusar; rama revive en `declarePackageTransfer` |
| `src/lib/payments/package-confirmation-state.ts` | Modify | estado `awaiting_transfer` |
| `src/components/packages/package-transfer-instructions.tsx` | Create | instrucciones extraídas (compartidas wizard + confirmation) |
| `src/components/packages/package-checkout.tsx` | Modify | importar las instrucciones extraídas |
| `src/app/paquetes/confirmation/transfer-panel.tsx` | Create | panel activo cliente ("Ya transferí" + revive) |
| `src/app/paquetes/confirmation/page.tsx` | Modify | render de `awaiting_transfer` y `expired` retomable |
| `src/lib/notifications/types.ts` | Modify | 2 tipos de email nuevos |
| `src/lib/notifications/templates.ts` | Modify | 4 templates nuevos (html/text × 2) |
| `src/lib/notifications/email-provider.ts` | Modify (append) | 2 senders nuevos |
| `src/lib/notifications/index.ts` | Modify | re-exports |
| `src/lib/cron/transfer-reminders.ts` | Modify | ramas de paquete (clienta + dueña) |
| `src/lib/loyalty/card-data.ts` | Modify | query de pending por transferencia + URL de retorno |
| `src/components/loyalty/loyalty-card.tsx` | Modify | sección "Paquetes por confirmar" |
| Tests | Create/Modify | detallados por task |

---

### Task 1: Migración — flags de recordatorio en PackagePurchase

**Files:**
- Modify: `prisma/schema.prisma` (model `PackagePurchase`, ~línea 780)
- Create: `prisma/migrations/<timestamp>_package_transfer_reminder_flags/migration.sql`

- [ ] **Step 1: Editar el schema**

En `model PackagePurchase`, después de `chargebackAt DateTime?`:

```prisma
  chargebackAt      DateTime?
  transferReminderCustomerSentAt DateTime?
  transferReminderBusinessSentAt DateTime?
```

- [ ] **Step 2: Generar la migración (create-only) y PODAR**

```bash
cd /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52
npx prisma migrate dev --name package_transfer_reminder_flags --create-only
```

**Landmine:** el diff contra la DB compartida puede traer statements de ramas hermanas (DROPs ajenos). Abrir el `.sql` generado y dejar SOLO:

```sql
ALTER TABLE "PackagePurchase" ADD COLUMN "transferReminderCustomerSentAt" TIMESTAMP(3);
ALTER TABLE "PackagePurchase" ADD COLUMN "transferReminderBusinessSentAt" TIMESTAMP(3);
```

- [ ] **Step 3: Aplicar y regenerar el cliente**

```bash
npx prisma migrate dev
npx prisma generate
```

Expected: migración aplicada sin errores. (Si se aplica a mano con `db execute`, correr también `npx prisma migrate resolve --applied <nombre>` — sin eso el `vercel-build` rompe.)

- [ ] **Step 4: Smoke de tipos**

```bash
npx tsc --noEmit | grep '^src/' | head
```

Expected: sin errores nuevos.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add prisma/schema.prisma prisma/migrations
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "feat(packages): flags de recordatorio de transferencia en PackagePurchase"
```

---

### Task 2: createPackagePurchase marca el método y re-arma el recordatorio

**Files:**
- Modify: `src/server/actions/packages-checkout.ts:96-139` (`createPackagePurchase`, tx)
- Test: `src/server/actions/packages-checkout.create.test.ts` (colocated, mocks ya armados)

- [ ] **Step 1: Tests que fallan**

Agregar al `describe('createPackagePurchase')` (el archivo ya mockea `getBankTransferInfo`? NO — lo mockea `packages-checkout.initiate.test.ts`; acá agregar el mock si falta). Verificar el head del archivo: si no existe `vi.mock('@/server/actions/bank-transfer-public', ...)`, agregarlo junto a los otros mocks:

```ts
const getBankTransferInfo = vi.fn()
vi.mock('@/server/actions/bank-transfer-public', () => ({
  getBankTransferInfo: (...a: unknown[]) => getBankTransferInfo(...a),
}))
```

y en el `beforeEach`: `getBankTransferInfo.mockResolvedValue({ holdHours: 48, accountHolder: 'X', rut: '1-9', bankName: 'B', accountType: 'c', accountNumber: '1' })` (+ `getBankTransferInfo.mockReset()` arriba). Tests nuevos:

```ts
it('marca paymentMethod Transferencia al crear con method transfer', async () => {
  await createPackagePurchase({ ...baseInput, method: 'transfer' })
  const data = tx.packagePurchase.create.mock.calls[0][0].data
  expect(data.paymentMethod).toBe('Transferencia')
})

it('deja paymentMethod null al crear con MP', async () => {
  await createPackagePurchase(baseInput)
  const data = tx.packagePurchase.create.mock.calls[0][0].data
  expect(data.paymentMethod).toBeNull()
})

it('el reuse actualiza paymentMethod y re-arma el recordatorio de la clienta', async () => {
  tx.packagePurchase.findFirst.mockResolvedValue({ id: 'ppExisting', holdExpiresAt: new Date(Date.now() + 60000) })
  await createPackagePurchase({ ...baseInput, method: 'transfer' })
  expect(tx.packagePurchase.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'ppExisting' },
    data: expect.objectContaining({
      paymentMethod: 'Transferencia',
      transferReminderCustomerSentAt: null,
      holdExpiresAt: expect.any(Date),
    }),
  }))
})

it('el reuse cambiando a MP limpia paymentMethod', async () => {
  tx.packagePurchase.findFirst.mockResolvedValue({ id: 'ppExisting', holdExpiresAt: new Date(Date.now() + 60000) })
  await createPackagePurchase(baseInput)
  const data = tx.packagePurchase.update.mock.calls[0][0].data
  expect(data.paymentMethod).toBeNull()
})
```

- [ ] **Step 2: Verificar que fallan**

```bash
npx vitest run src/server/actions/packages-checkout.create.test.ts
```

Expected: los 4 tests nuevos FAIL (paymentMethod undefined).

- [ ] **Step 3: Implementación**

En `createPackagePurchase`, dentro de la tx:

```ts
    // Marcar el método elegido en la compra: una pending sin Payments era ambigua
    // (¿transferencia abandonada o MP nunca iniciado?). 'Transferencia' habilita la
    // confirmation activa, los recordatorios y /mi; MP queda null (como siempre).
    const purchasePaymentMethod = method === 'transfer' ? 'Transferencia' : null

    const existing = await tx.packagePurchase.findFirst({ /* sin cambios */ })
    if (existing) {
      // Reintento (posible cambio de método): recalcular hold + método, y re-armar
      // el recordatorio de la clienta (hold nuevo ⇒ aviso nuevo).
      await tx.packagePurchase.update({
        where: { id: existing.id },
        data: { holdExpiresAt, paymentMethod: purchasePaymentMethod, transferReminderCustomerSentAt: null },
      })
      return existing.id
    }

    const created = await tx.packagePurchase.create({
      data: {
        /* ...campos existentes sin cambios... */
        paymentMethod: purchasePaymentMethod,
      },
    })
```

- [ ] **Step 4: Verificar que pasan (archivo completo)**

```bash
npx vitest run src/server/actions/packages-checkout.create.test.ts
```

Expected: PASS completo (los tests viejos no deben romperse).

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add src/server/actions/packages-checkout.ts src/server/actions/packages-checkout.create.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "feat(packages): marcar método de pago al crear/reusar la compra online"
```

---

### Task 3: Estado `awaiting_transfer` en derivePackageConfirmationState

**Files:**
- Modify: `src/lib/payments/package-confirmation-state.ts`
- Test: `tests/unit/package-confirmation-state.test.ts` (crear; si ya existe un test de este módulo con otro nombre — buscar con `grep -rl derivePackageConfirmationState tests/` — extenderlo en su lugar)

- [ ] **Step 1: Test que falla**

```ts
import { describe, it, expect } from 'vitest'
import { derivePackageConfirmationState } from '@/lib/payments/package-confirmation-state'

const base = { status: 'pending', paymentMethod: null as string | null, chargebackAt: null, payments: [] as { status: string; provider: string; providerPaymentId?: string | null }[] }

describe('derivePackageConfirmationState — awaiting_transfer', () => {
  it('pending + Transferencia sin declarar → awaiting_transfer', () => {
    expect(derivePackageConfirmationState({ ...base, paymentMethod: 'Transferencia' })).toBe('awaiting_transfer')
  })

  it('pending + Transferencia declarada → pending (en verificación)', () => {
    expect(derivePackageConfirmationState({
      ...base, paymentMethod: 'Transferencia',
      payments: [{ status: 'pending', provider: 'manual', providerPaymentId: 'bt-pkg-declared:pp1' }],
    })).toBe('pending')
  })

  it('pending + Transferencia pero con MP en vuelo → NO awaiting_transfer (espejo del where de reservas)', () => {
    expect(derivePackageConfirmationState({
      ...base, paymentMethod: 'Transferencia',
      payments: [{ status: 'pending', provider: 'mercado_pago', providerPaymentId: null }],
    })).toBe('pending')
  })

  it('pending + MP aprobado (webhook en camino) → active aunque el método diga Transferencia', () => {
    expect(derivePackageConfirmationState({
      ...base, paymentMethod: 'Transferencia',
      payments: [{ status: 'approved', provider: 'mercado_pago', providerPaymentId: 'mp1' }],
    })).toBe('active')
  })

  it('pending sin método (MP nunca iniciado) → pending, como hoy', () => {
    expect(derivePackageConfirmationState(base)).toBe('pending')
  })

  it('terminales mandan: expired con Transferencia sigue siendo expired', () => {
    expect(derivePackageConfirmationState({ ...base, status: 'expired', paymentMethod: 'Transferencia' })).toBe('expired')
  })
})
```

- [ ] **Step 2: Verificar que falla**

```bash
npx vitest run tests/unit/package-confirmation-state.test.ts
```

Expected: FAIL (`awaiting_transfer` no existe / paymentMethod no es parte del input).

- [ ] **Step 3: Implementación**

Reemplazar el módulo por:

```ts
import { isDeclaredPkgTransferPayment } from '@/lib/bank-transfer/declared'

export type PackageConfirmationState =
  | 'active'
  | 'pending'
  | 'awaiting_transfer'
  | 'rejected'
  | 'expired'
  | 'refunded'
  | 'disputed'

interface DeriveInput {
  status: string
  /** PackagePurchase.paymentMethod: 'Transferencia' cuando la clienta eligió transferir. */
  paymentMethod?: string | null
  /** Set sólo en un chargeback (distingue disputed de un refund voluntario). */
  chargebackAt?: Date | null
  payments: { status: string; provider: string; providerPaymentId?: string | null }[]
}

/** Mirror liviano de deriveConfirmationState para compras de paquete. El status
 *  de la compra manda (terminal); si sigue pending, se deriva del método + pagos.
 *  `awaiting_transfer` = eligió transferencia y todavía no declaró NI hay un pago
 *  MP en vuelo (espejo del where del recordatorio de reservas: un MP iniciado en
 *  otra pestaña no debe mostrar "te falta transferir"). */
export function derivePackageConfirmationState(input: DeriveInput): PackageConfirmationState {
  if (input.status === 'active') return 'active'
  if (input.status === 'expired') return 'expired'
  if (input.status === 'refunded') return input.chargebackAt ? 'disputed' : 'refunded'
  if (input.status === 'rejected') return 'rejected'
  if (input.payments.some(p => p.status === 'approved')) return 'active'
  if (
    input.paymentMethod === 'Transferencia' &&
    !input.payments.some(isDeclaredPkgTransferPayment) &&
    !input.payments.some(p => p.provider === 'mercado_pago' && (p.status === 'pending' || p.status === 'in_process'))
  ) {
    return 'awaiting_transfer'
  }
  if (input.payments.some(p => p.status === 'pending' || p.status === 'in_process')) return 'pending'
  if (input.payments.some(p => p.status === 'rejected' || p.status === 'cancelled')) return 'rejected'
  return 'pending'
}
```

Nota: el input de `payments` ahora exige `provider`; el caller (Task 6) amplía su select. Si `tsc` marca otros callers, ampliar sus selects igual.

- [ ] **Step 4: Verificar que pasa + tsc**

```bash
npx vitest run tests/unit/package-confirmation-state.test.ts && npx tsc --noEmit | grep '^src/'
```

Expected: tests PASS; tsc puede marcar `src/app/paquetes/confirmation/page.tsx` (select sin `provider`/`paymentMethod`) — se arregla en Task 6; si es el ÚNICO error, seguir (anotarlo); el gate final exige 0.
Para no dejar la rama roja entre tasks: en este mismo paso, ampliar el select de la página (adelanto mínimo de Task 6):

```ts
      payments: { select: { status: true, provider: true, providerPaymentId: true } },
```

y el `findUnique` ya trae `paymentMethod` por ser scalar (el `include` no lo filtra). Re-correr tsc → 0 errores en `src/`.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add src/lib/payments/package-confirmation-state.ts tests/unit/package-confirmation-state.test.ts src/app/paquetes/confirmation/page.tsx
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "feat(packages): estado awaiting_transfer en la confirmación de compra"
```

---

### Task 4: Rama revive (expired → pending) en declarePackageTransfer

**Files:**
- Modify: `src/server/actions/packages-checkout.ts:312-362` (`declarePackageTransfer`)
- Test: `tests/integration/packages.transfer.integration.test.ts` (extender; usa el seed existente con `holdHours: 48`)

- [ ] **Step 1: Tests de integración que fallan**

Agregar al describe existente (helpers `prisma`, `productId`, `BIZ`, `USER` ya seedeados; el `beforeEach` limpia purchases):

```ts
  it('revive una expirada por transferencia: expired→pending con hold nuevo + Payment declarado + flags reset', async () => {
    const { createPackagePurchase, declarePackageTransfer } = await import('@/server/actions/packages-checkout')
    const { purchaseId } = await createPackagePurchase({
      packageProductId: productId, name: 'Cli Xfer', phone: '+56900000009', acceptedTerms: true, method: 'transfer',
    })
    // Simular el sweep: expirada sin declarar, con flag de recordatorio ya gastado.
    await prisma.packagePurchase.update({
      where: { id: purchaseId },
      data: { status: 'expired', holdExpiresAt: new Date(Date.now() - 3600_000), transferReminderCustomerSentAt: new Date() },
    })

    await declarePackageTransfer({ purchaseId })

    const p = await prisma.packagePurchase.findUnique({ where: { id: purchaseId }, include: { payments: true } })
    expect(p!.status).toBe('pending')
    expect(p!.holdExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 47 * 3600_000) // holdHours=48 del seed
    expect(p!.transferReminderCustomerSentAt).toBeNull()
    expect(p!.transferReminderBusinessSentAt).toBeNull()
    const declared = p!.payments.find(x => x.providerPaymentId === `bt-pkg-declared:${purchaseId}`)
    expect(declared?.status).toBe('pending')
  })

  it('NO revive si el precio del producto cambió', async () => {
    const { createPackagePurchase, declarePackageTransfer } = await import('@/server/actions/packages-checkout')
    const { purchaseId } = await createPackagePurchase({
      packageProductId: productId, name: 'Cli Xfer', phone: '+56900000009', acceptedTerms: true, method: 'transfer',
    })
    await prisma.packagePurchase.update({ where: { id: purchaseId }, data: { status: 'expired' } })
    await prisma.packageProduct.update({ where: { id: productId }, data: { price: 60000 } })
    try {
      await expect(declarePackageTransfer({ purchaseId })).rejects.toThrow(/cambió/i)
      const p = await prisma.packagePurchase.findUnique({ where: { id: purchaseId } })
      expect(p!.status).toBe('expired')
    } finally {
      await prisma.packageProduct.update({ where: { id: productId }, data: { price: 50000 } })
    }
  })

  it('NO revive si el producto fue desactivado', async () => {
    const { createPackagePurchase, declarePackageTransfer } = await import('@/server/actions/packages-checkout')
    const { purchaseId } = await createPackagePurchase({
      packageProductId: productId, name: 'Cli Xfer', phone: '+56900000009', acceptedTerms: true, method: 'transfer',
    })
    await prisma.packagePurchase.update({ where: { id: purchaseId }, data: { status: 'expired' } })
    await prisma.packageProduct.update({ where: { id: productId }, data: { isActive: false } })
    try {
      await expect(declarePackageTransfer({ purchaseId })).rejects.toThrow(/cambió/i)
    } finally {
      await prisma.packageProduct.update({ where: { id: productId }, data: { isActive: true } })
    }
  })

  it('NO revive una expirada que no era de transferencia (paymentMethod null)', async () => {
    const { createPackagePurchase, declarePackageTransfer } = await import('@/server/actions/packages-checkout')
    const { purchaseId } = await createPackagePurchase({
      packageProductId: productId, name: 'Cli Xfer', phone: '+56900000009', acceptedTerms: true, method: 'mp',
    })
    await prisma.packagePurchase.update({ where: { id: purchaseId }, data: { status: 'expired' } })
    await expect(declarePackageTransfer({ purchaseId })).rejects.toThrow(/ya fue procesada/i)
  })

  it('revivida → confirmable por la dueña → activa con grants (ciclo completo)', async () => {
    const { createPackagePurchase, declarePackageTransfer } = await import('@/server/actions/packages-checkout')
    const { confirmPackageTransfer } = await import('@/server/actions/bank-transfer-verify')
    const { purchaseId } = await createPackagePurchase({
      packageProductId: productId, name: 'Cli Xfer', phone: '+56900000009', acceptedTerms: true, method: 'transfer',
    })
    await prisma.packagePurchase.update({ where: { id: purchaseId }, data: { status: 'expired' } })
    await declarePackageTransfer({ purchaseId })
    const declared = await prisma.payment.findFirst({ where: { packagePurchaseId: purchaseId, provider: 'manual' } })
    await confirmPackageTransfer(declared!.id)
    const p = await prisma.packagePurchase.findUnique({ where: { id: purchaseId }, include: { grants: true } })
    expect(p!.status).toBe('active')
    expect(p!.grants.length).toBe(5)
  })
```

Nota: `method: 'mp'` en el seed requiere que `resolveOnlinePaymentAvailabilityForBusiness` esté disponible en integración — verificar cómo lo resuelven los tests existentes del archivo (si el negocio no tiene MP configurado, ese `createPackagePurchase` con `method: 'mp'` va a tirar; en ese caso crear la purchase MP directo con `prisma.packagePurchase.create({ data: { businessId: BIZ, customerId, packageProductId: productId, pricePaid: 50000, quantity: 5, bonusQuantity: 0, coversAll: true, coveredServiceIds: [], source: 'online', status: 'expired', paymentMethod: null } })` — el customer sale de un create previo con `method: 'transfer'`).

- [ ] **Step 2: Verificar que fallan**

```bash
npx vitest run tests/integration/packages.transfer.integration.test.ts
```

Expected: los tests nuevos FAIL con "Esta compra ya fue procesada." (la action rechaza expired). Requiere el Postgres local de test (`agendita-test-pg` :5433) levantado; **no re-seedear con el dev server vivo**.

- [ ] **Step 3: Implementación**

Reemplazar el cuerpo de `declarePackageTransfer`:

```ts
/** Declaración pública "ya transferí" de una compra de paquete por transferencia.
 *  También REVIVE una compra expirada (self-service, decisión del spec §5): un
 *  paquete no bloquea cupo, así que si el producto sigue vigente al mismo precio,
 *  expired→pending con hold nuevo en el mismo acto de declarar. */
export async function declarePackageTransfer(input: { purchaseId: string }): Promise<{ ok: true }> {
  const user = await getCurrentUser()
  if (!user) throw new Error('Debes iniciar sesión.')
  const limit = await checkRateLimit('declare-package-transfer', 20, 60000, { userId: user.id })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')

  const purchase = await loadOwnedPurchase(input.purchaseId, user.id)
  // Sólo una expirada QUE ERA de transferencia es retomable; MP expirado se recompra
  // y rejected es terminal (la dueña ya miró y dijo no).
  const isRevive = purchase.status === 'expired' && purchase.paymentMethod === 'Transferencia'
  if (purchase.status !== 'pending' && !isRevive) throw new Error('Esta compra ya fue procesada.')
  // SIN check de hold a propósito (fix zombie, spec §5): la plata pudo enviarse
  // aunque el hold venciera y acá no hay cupo en juego. La ventana la cierra el
  // sweep: cuando expira la compra no-declarada, cae en la rama revive de arriba.

  let reviveHoldHours: number | null = null
  if (isRevive) {
    const [transferInfo, product] = await Promise.all([
      getBankTransferInfo(purchase.businessId),
      prisma.packageProduct.findUnique({
        where: { id: purchase.packageProductId },
        select: { isActive: true, price: true },
      }),
    ])
    if (!transferInfo) throw new Error('Transferencia bancaria no disponible para este negocio.')
    // Guard de producto: revivir mantiene el precio snapshot; si el catálogo cambió,
    // la compra vieja ya no representa la oferta actual.
    if (!product?.isActive || product.price !== purchase.pricePaid) {
      throw new Error('Este paquete cambió. Iniciá la compra de nuevo.')
    }
    reviveHoldHours = transferInfo.holdHours
  }

  const declaredId = btPkgDeclaredId(purchase.id)
  await prisma.$transaction(async (tx) => {
    // CAS sobre la fila de la compra DENTRO de la misma tx que crea el Payment:
    // toma el lock y re-valida el status leído, serializando contra el sweep y
    // contra otra pestaña. count 0 ⇒ alguien la movió en el medio.
    const guard = isRevive
      ? await tx.packagePurchase.updateMany({
          where: { id: purchase.id, status: 'expired' },
          data: {
            status: 'pending',
            holdExpiresAt: addHours(new Date(), reviveHoldHours!),
            // Compra revivida = ciclo nuevo: los recordatorios vuelven a armarse.
            transferReminderCustomerSentAt: null,
            transferReminderBusinessSentAt: null,
          },
        })
      : await tx.packagePurchase.updateMany({
          where: { id: purchase.id, status: 'pending' },
          data: { status: 'pending' },
        })
    if (guard.count === 0) throw new Error('Esta compra ya fue procesada.')

    // Robustez del revive: si quedó un declarado 'cancelled' de un ciclo anterior
    // (hoy inalcanzable: el sweep exime declaradas), reactivarlo con createdAt=now
    // ("declaró de nuevo") para que el recordatorio de la dueña no dispare al instante.
    // Sólo toca 'cancelled': un 'approved' jamás se pisa (espejo del fix A2 de reservas).
    await tx.payment.updateMany({
      where: { packagePurchaseId: purchase.id, provider: 'manual', providerPaymentId: declaredId, status: 'cancelled' },
      data: { status: 'pending', createdAt: new Date() },
    })
    // Idempotente por @@unique([packagePurchaseId, provider, providerPaymentId]).
    await tx.payment.upsert({
      where: { packagePurchaseId_provider_providerPaymentId: {
        packagePurchaseId: purchase.id, provider: 'manual', providerPaymentId: declaredId,
      } },
      update: {},
      create: {
        businessId: purchase.businessId, packagePurchaseId: purchase.id, customerId: purchase.customerId,
        provider: 'manual', providerPaymentId: declaredId, amount: purchase.pricePaid,
        currency: purchase.business.currency || 'CLP', status: 'pending',
        paymentType: 'package_purchase', paymentMethod: 'Transferencia',
      },
    })
  })

  // Notificar a la dueña (best-effort, no bloquea la declaración de la clienta).
  await sendMultiNotificationSafely('package transfer declared business', async () =>
    sendPackageTransferDeclaredToBusiness(purchase.businessId, {
      businessName: purchase.business.name, customerName: purchase.customer.name, productName: purchase.product.name,
      amount: purchase.pricePaid, businessCurrency: purchase.business.currency || 'CLP',
    }),
  )

  return { ok: true }
}
```

(`addHours` ya está importado en el archivo; `getBankTransferInfo` también.)

- [ ] **Step 4: Verificar que pasan**

```bash
npx vitest run tests/integration/packages.transfer.integration.test.ts
```

Expected: PASS completo (tests viejos incluidos).

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add src/server/actions/packages-checkout.ts tests/integration/packages.transfer.integration.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "feat(packages): revive self-service de compra expirada al declarar transferencia"
```

---

### Task 5: Extraer PackageTransferInstructions a componente compartido

**Files:**
- Create: `src/components/packages/package-transfer-instructions.tsx`
- Modify: `src/components/packages/package-checkout.tsx` (borrar la función local `PackageTransferInstructions` de ~línea 236 en adelante e importarla)
- Test: `tests/unit/package-checkout-transfer.test.tsx` (existente — debe seguir verde sin cambios)

- [ ] **Step 1: Crear el componente compartido**

Mover el bloque completo de `package-checkout.tsx` (la función `PackageTransferInstructions` con su comentario "NO reutiliza @/components/booking/transfer-details...") a un archivo nuevo, EXPORTADA, con los mismos props e imports que necesita (`BankTransferPublicInfo`, `formatMoney`, `Button`). El cuerpo no cambia — es un move, no un rewrite. Encabezado del archivo nuevo:

```tsx
'use client'

import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/money'
import type { BankTransferPublicInfo } from '@/lib/bank-transfer/public-info'

// Vista de instrucciones de transferencia para paquetes, compartida por el wizard
// (package-checkout) y la confirmation activa (transfer-panel). NO reutiliza
// @/components/booking/transfer-details: esa está acoplada a reservas (deadline
// obligatorio, comprobante, copy de abono) y declarePackageTransfer es
// deliberadamente sin comprobante.
export function PackageTransferInstructions({ ... }) { /* cuerpo movido tal cual */ }
```

En `package-checkout.tsx`: borrar la función local y agregar
`import { PackageTransferInstructions } from '@/components/packages/package-transfer-instructions'`.

- [ ] **Step 2: Verificar que el test existente sigue verde + tsc**

```bash
npx vitest run tests/unit/package-checkout-transfer.test.tsx && npx tsc --noEmit | grep '^src/'
```

Expected: PASS, 0 errores tsc.

- [ ] **Step 3: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add src/components/packages/package-transfer-instructions.tsx src/components/packages/package-checkout.tsx
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "refactor(packages): extraer PackageTransferInstructions a componente compartido"
```

---

### Task 6: Confirmation activa — PackageTransferPanel + página

**Files:**
- Create: `src/app/paquetes/confirmation/transfer-panel.tsx`
- Modify: `src/app/paquetes/confirmation/page.tsx`
- Test: `tests/unit/package-confirmation-transfer-panel.test.tsx` (crear)

- [ ] **Step 1: Test del panel que falla** (mock de `next/navigation` — landmine conocida)

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/server/actions/packages-checkout', () => ({ declarePackageTransfer: vi.fn() }))

import { PackageTransferPanel } from '@/app/paquetes/confirmation/transfer-panel'

const bank = {
  accountHolder: 'Estudio Luna', rut: '11.111.111-1', bankName: 'Banco Estado',
  accountType: 'corriente', accountNumber: '123456', email: null, instructions: null, holdHours: 48,
}

describe('PackageTransferPanel', () => {
  it('muestra los datos bancarios, el monto y el botón Ya transferí', () => {
    const html = renderToStaticMarkup(
      <PackageTransferPanel transferInfo={bank} amount={50000} currency="CLP" purchaseId="pp1" />,
    )
    expect(html).toContain('Estudio Luna')
    expect(html).toContain('123456')
    expect(html).toContain('Ya transferí')
  })
})
```

- [ ] **Step 2: Verificar que falla**

```bash
npx vitest run tests/unit/package-confirmation-transfer-panel.test.tsx
```

Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar el panel**

`src/app/paquetes/confirmation/transfer-panel.tsx` (espejo de `src/app/book/confirmation/transfer-panel.tsx`, sin comprobante):

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PackageTransferInstructions } from '@/components/packages/package-transfer-instructions'
import { declarePackageTransfer } from '@/server/actions/packages-checkout'
import type { BankTransferPublicInfo } from '@/lib/bank-transfer/public-info'

/** Superficie ACTIVA de /paquetes/confirmation: la clienta que cerró la pestaña
 *  del wizard (o cuya compra expiró y sigue retomable) ve los datos bancarios y
 *  declara desde acá. En expired, declarar REVIVE la compra (server-side). */
export function PackageTransferPanel({ transferInfo, amount, currency, purchaseId }: {
  transferInfo: BankTransferPublicInfo
  amount: number
  currency: string
  purchaseId: string
}) {
  const router = useRouter()
  const [declaring, setDeclaring] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDeclare() {
    setDeclaring(true)
    setError(null)
    try {
      await declarePackageTransfer({ purchaseId })
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos registrar tu aviso')
      setDeclaring(false)
    }
  }

  return (
    <div className="mt-6">
      <PackageTransferInstructions
        transferInfo={transferInfo}
        amount={amount}
        currency={currency}
        declaring={declaring}
        onDeclare={handleDeclare}
      />
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
```

(Ajustar los nombres de props de `PackageTransferInstructions` a los reales del componente extraído en Task 5 — son `transferInfo/amount/currency/declaring/onDeclare`.)

- [ ] **Step 4: Modificar la página**

En `src/app/paquetes/confirmation/page.tsx`:

1. El select de payments ya quedó ampliado en Task 3; sumar al `product` select e importar lo nuevo:

```ts
import { PackageTransferPanel } from './transfer-panel'
import { getBankTransferInfo } from '@/server/actions/bank-transfer-public'
// ...
      product: { select: { name: true, isActive: true, price: true } },
```

2. Después de `const state = derivePackageConfirmationState(purchase)`:

```ts
  // Superficie activa: en awaiting_transfer siempre; en expired sólo si la compra
  // sigue retomable (era transferencia + producto vigente al mismo precio + el
  // negocio mantiene transferencia habilitada). El guard server-side real vive en
  // declarePackageTransfer; esto sólo decide si mostrar el panel.
  const wantsTransferPanel =
    state === 'awaiting_transfer' ||
    (state === 'expired' &&
      purchase.paymentMethod === 'Transferencia' &&
      purchase.product.isActive &&
      purchase.product.price === purchase.pricePaid)
  const transferInfo = wantsTransferPanel ? await getBankTransferInfo(purchase.businessId) : null
  const showTransferPanel = wantsTransferPanel && transferInfo != null
```

3. Config de copy: agregar la entrada `awaiting_transfer` y bifurcar la de `expired`:

```ts
    awaiting_transfer: {
      icon: Clock,
      iconColor: 'text-amber-500',
      iconBg: 'bg-amber-50',
      title: 'Te falta transferir',
      message: 'Reservamos tu paquete. Transferí y avisanos con "Ya transferí" para que el negocio confirme tu compra.',
    },
    expired: showTransferPanel
      ? {
          icon: Clock,
          iconColor: 'text-muted-foreground',
          iconBg: 'bg-muted',
          title: 'Tu compra expiró',
          message: 'Se venció el plazo, pero todavía podés retomarla: transferí y avisanos con "Ya transferí".',
        }
      : {
          icon: Clock,
          iconColor: 'text-muted-foreground',
          iconBg: 'bg-muted',
          title: 'Tu compra expiró',
          message: 'Se venció el tiempo para completar el pago. Podés iniciar la compra de nuevo.',
        },
```

4. Render del panel, entre la card de detalle y el botón "Ver mis paquetes":

```tsx
        {showTransferPanel && (
          <PackageTransferPanel
            transferInfo={transferInfo}
            amount={purchase.pricePaid}
            currency={purchase.business.currency || 'CLP'}
            purchaseId={purchase.id}
          />
        )}
```

- [ ] **Step 5: Verificar test + tsc**

```bash
npx vitest run tests/unit/package-confirmation-transfer-panel.test.tsx && npx tsc --noEmit | grep '^src/'
```

Expected: PASS, 0 errores.

- [ ] **Step 6: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add src/app/paquetes/confirmation/transfer-panel.tsx src/app/paquetes/confirmation/page.tsx tests/unit/package-confirmation-transfer-panel.test.tsx
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "feat(packages): confirmation activa — datos bancarios + Ya transferí + retomar expirada"
```

---

### Task 7: Emails — recordatorio a la clienta y "sin verificar" a la dueña

**Files:**
- Modify: `src/lib/notifications/types.ts` (2 interfaces nuevas al final)
- Modify: `src/lib/notifications/templates.ts` (4 funciones nuevas al final)
- Modify: `src/lib/notifications/email-provider.ts` (2 senders **al final del archivo** — es el único archivo compartido con la sesión de la rama C; append-only para minimizar conflicto)
- Modify: `src/lib/notifications/index.ts` (re-exports)
- Test: `tests/unit/package-transfer-reminder-emails.test.ts` (crear)

- [ ] **Step 1: Test que falla**

```ts
import { describe, it, expect } from 'vitest'
import {
  packageTransferReminderCustomerHtml,
  packageTransferReminderCustomerText,
  packageTransferUnverifiedBusinessHtml,
  packageTransferUnverifiedBusinessText,
} from '@/lib/notifications/templates'

const bankTransfer = {
  accountHolder: 'Estudio Luna', rut: '11.111.111-1', bankName: 'Banco Estado', accountType: 'corriente',
  accountNumber: '123456', email: null, instructions: null,
  deadline: new Date('2026-07-18T12:00:00Z'), confirmationUrl: 'https://luna.agendita.cl/paquetes/confirmation?purchaseId=pp1',
}
const customerData = {
  businessName: 'Estudio Luna', businessTimezone: 'America/Santiago', customerName: 'Ana',
  productName: 'Pack 5 sesiones', amount: 50000, businessCurrency: 'CLP', bankTransfer,
}

describe('templates de recordatorio de transferencia de paquete', () => {
  it('clienta: html con producto, datos bancarios y link de retorno', () => {
    const html = packageTransferReminderCustomerHtml(customerData)
    expect(html).toContain('Pack 5 sesiones')
    expect(html).toContain('123456')
    expect(html).toContain('purchaseId=pp1')
  })
  it('clienta: text con el link', () => {
    expect(packageTransferReminderCustomerText(customerData)).toContain('purchaseId=pp1')
  })
  it('dueña: html con clienta, producto y link al dashboard', () => {
    const html = packageTransferUnverifiedBusinessHtml({
      businessName: 'Estudio Luna', customerName: 'Ana', productName: 'Pack 5 sesiones', dashboardUrl: 'https://app/dashboard',
    })
    expect(html).toContain('Ana')
    expect(html).toContain('Pack 5 sesiones')
    expect(html).toContain('https://app/dashboard')
  })
  it('dueña: text', () => {
    expect(packageTransferUnverifiedBusinessText({
      businessName: 'Estudio Luna', customerName: 'Ana', productName: 'Pack 5 sesiones', dashboardUrl: 'https://app/dashboard',
    })).toContain('Pack 5 sesiones')
  })
})
```

- [ ] **Step 2: Verificar que falla**

```bash
npx vitest run tests/unit/package-transfer-reminder-emails.test.ts
```

Expected: FAIL (exports inexistentes).

- [ ] **Step 3: Tipos** (`types.ts`, al final)

```ts
export interface PackageTransferReminderCustomerEmailData {
  businessName: string
  businessTimezone: string
  customerName: string
  productName: string
  amount: number
  businessCurrency: string
  bankTransfer: NonNullable<BookingEmailData['bankTransfer']>
  customerEmail?: string
  businessReplyToEmail?: string | null
}

export interface PackageTransferUnverifiedBusinessEmailData {
  businessName: string
  customerName: string
  productName: string
  dashboardUrl: string
}
```

- [ ] **Step 4: Templates** (`templates.ts`, al final; usar los helpers existentes `baseHtml`, `header`, `footer`, `escapeHtml`, `fmtCurrency`, `bankTransferBlockHtml`, `bankTransferBlockText` — mismos que usan los templates de reservas; importar los tipos nuevos donde el archivo importa los demás)

```ts
export function packageTransferReminderCustomerHtml(data: PackageTransferReminderCustomerEmailData): string {
  const total = fmtCurrency(data.amount, data.businessCurrency)
  return baseHtml(`
    ${header('Te quedan pocas horas para transferir')}
    <p style="font-size:15px">Hola ${escapeHtml(data.customerName)}, tu compra del paquete <strong>${escapeHtml(data.productName)}</strong> sigue pendiente. Transferí y avisanos hoy para que el negocio la confirme.</p>
    ${bankTransferBlockHtml(data.bankTransfer, total, data.businessTimezone)}
    ${footer(data.businessName)}
  `)
}

export function packageTransferReminderCustomerText(data: PackageTransferReminderCustomerEmailData): string {
  const total = fmtCurrency(data.amount, data.businessCurrency)
  return [
    `Hola ${data.customerName}, tu compra del paquete ${data.productName} sigue pendiente.`,
    `Transferí y avisanos hoy para que el negocio la confirme.`,
    ...bankTransferBlockText(data.bankTransfer, total, data.businessTimezone),
  ].join('\n')
}

export function packageTransferUnverifiedBusinessHtml(data: PackageTransferUnverifiedBusinessEmailData): string {
  return baseHtml(`
    ${header('Tenés una transferencia de paquete por verificar')}
    <p style="font-size:15px">${escapeHtml(data.customerName)} declaró una transferencia por el paquete <strong>${escapeHtml(data.productName)}</strong> hace más de un día y sigue sin verificar. Revisá tu cuenta y confirmá o rechazá la compra.</p>
    <p style="margin-top:16px"><a href="${escapeHtml(data.dashboardUrl)}" style="color:#e91e63;text-decoration:none;font-weight:600">Ir a verificar en el dashboard →</a></p>
    ${footer(data.businessName)}
  `)
}

export function packageTransferUnverifiedBusinessText(data: PackageTransferUnverifiedBusinessEmailData): string {
  return `${data.customerName} declaró una transferencia por el paquete ${data.productName} en ${data.businessName} hace más de un día y sigue sin verificar. Revisá tu cuenta y confirmá o rechazá la compra. Ir al dashboard: ${data.dashboardUrl}`
}
```

Nota: si `bankTransferBlockHtml/Text` hardcodean la palabra "abono" en su label (ver `templates.ts:92`), pasar el label que corresponda si aceptan parámetro; si no lo aceptan, dejarlo — dicen "Datos para transferir el abono (<monto>)" y para paquetes el monto es el total. Si el copy queda confuso, generalizar el helper con un parámetro `label = 'abono'` SIN tocar los call sites existentes (default preserva el copy actual).

- [ ] **Step 5: Senders** (`email-provider.ts`, **append al final**; mismos patrones que `sendTransferReminderToCustomer` / `sendTransferReminderToBusiness` — incluir los imports de tipos donde corresponda)

```ts
export async function sendPackageTransferReminderToCustomer(data: PackageTransferReminderCustomerEmailData): Promise<EmailResult> {
  if (!data.customerEmail) return { success: false, skipped: 'Cliente sin email' }
  return sendEmail(
    data.customerEmail,
    `Te quedan pocas horas para transferir - ${data.businessName}`,
    packageTransferReminderCustomerHtml(data),
    packageTransferReminderCustomerText(data),
    { replyTo: data.businessReplyToEmail },
  )
}

export async function sendPackageTransferUnverifiedToBusiness(
  businessId: string,
  data: Omit<PackageTransferUnverifiedBusinessEmailData, 'dashboardUrl'>,
): Promise<EmailResult[]> {
  const owners = await getBusinessOwnerEmails(businessId)
  if (owners.length === 0) return [{ success: false, skipped: 'No hay owners/admins con email para el negocio' }]
  const dashboardUrl = buildDashboardLink()
  const html = packageTransferUnverifiedBusinessHtml({ ...data, dashboardUrl })
  const text = packageTransferUnverifiedBusinessText({ ...data, dashboardUrl })
  return Promise.all(owners.map((owner) =>
    sendEmail(owner.email, `Transferencia de paquete por verificar - ${data.businessName}`, html, text, {}),
  ))
}
```

- [ ] **Step 6: Re-exports en `index.ts`** (junto a los demás senders):

```ts
  sendPackageTransferReminderToCustomer,
  sendPackageTransferUnverifiedToBusiness,
```

- [ ] **Step 7: Verificar**

```bash
npx vitest run tests/unit/package-transfer-reminder-emails.test.ts && npx tsc --noEmit | grep '^src/'
```

Expected: PASS, 0 errores.

- [ ] **Step 8: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add src/lib/notifications/types.ts src/lib/notifications/templates.ts src/lib/notifications/email-provider.ts src/lib/notifications/index.ts tests/unit/package-transfer-reminder-emails.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "feat(notifications): emails de recordatorio de transferencia de paquete"
```

---

### Task 8: Ramas de paquete en el cron transfer-reminders

**Files:**
- Modify: `src/lib/cron/transfer-reminders.ts`
- Test: `tests/unit/package-transfer-reminders.test.ts` (crear, self-contained — NO tocar `tests/unit/transfer-reminders.test.ts`)
- Test integración: `tests/integration/package-transfer-reminders.test.ts` (crear)

- [ ] **Step 1: Unit test que falla** (db mockeado + deps inyectadas, patrón del módulo)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { addHours, subHours } from 'date-fns'
import { sendTransferReminders } from '@/lib/cron/transfer-reminders'

vi.mock('@/lib/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/notifications')>()),
  getBusinessReplyToEmail: async () => null,
  sendNotificationSafely: async (_l: string, fn: () => Promise<{ success: boolean }>) => fn(),
  sendMultiNotificationSafely: async (_l: string, fn: () => Promise<{ success: boolean }[]>) => fn(),
}))

const now = new Date('2026-07-16T12:00:00Z')
const acct = {
  accountHolder: 'X', rut: '1-9', bankName: 'B', accountType: 'c', accountNumber: '1',
  email: null, instructions: null, isEnabled: true, holdHours: 48,
}
const biz = { id: 'b1', name: 'Biz', timezone: 'America/Santiago', currency: 'CLP', slug: 'biz', subdomain: null, bankTransferAccount: acct }

function makeDb(purchases: unknown[]) {
  return {
    booking: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    packagePurchase: { findMany: vi.fn().mockResolvedValue(purchases), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  }
}

const basePurchase = {
  id: 'pp1', pricePaid: 50000, holdExpiresAt: addHours(now, 2),
  customer: { name: 'Ana', email: 'ana@x.cl' },
  product: { name: 'Pack 5' },
  business: biz,
}

describe('sendTransferReminders — rama paquetes', () => {
  const sendCustomer = vi.fn().mockResolvedValue({ success: true })
  const sendBusiness = vi.fn().mockResolvedValue([{ success: true }])
  const sendPkgCustomer = vi.fn().mockResolvedValue({ success: true })
  const sendPkgBusiness = vi.fn().mockResolvedValue([{ success: true }])
  const deps = { sendCustomer, sendBusiness, sendPkgCustomer, sendPkgBusiness }

  beforeEach(() => { vi.clearAllMocks() })

  it('reclama y manda el recordatorio a la clienta con el link de la confirmation', async () => {
    const db = makeDb([basePurchase])
    // findMany de la rama dueña devuelve [] en la segunda llamada
    db.packagePurchase.findMany.mockResolvedValueOnce([basePurchase]).mockResolvedValueOnce([])
    const res = await sendTransferReminders(now, db as never, deps as never)
    expect(res.packageCustomerSent).toBe(1)
    const arg = sendPkgCustomer.mock.calls[0][0]
    expect(arg.productName).toBe('Pack 5')
    expect(arg.bankTransfer.confirmationUrl).toContain('purchaseId=pp1')
    // claim CAS con where completo
    expect(db.packagePurchase.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'pp1' }),
      data: { transferReminderCustomerSentAt: now },
    }))
  })

  it('si el claim pierde la carrera (count 0), no manda', async () => {
    const db = makeDb([])
    db.packagePurchase.findMany.mockResolvedValueOnce([basePurchase]).mockResolvedValueOnce([])
    db.packagePurchase.updateMany.mockResolvedValue({ count: 0 })
    const res = await sendTransferReminders(now, db as never, deps as never)
    expect(sendPkgCustomer).not.toHaveBeenCalled()
    expect(res.packageCustomerSent).toBe(0)
  })

  it('manda el aviso a la dueña por declarada envejecida (rama dueña)', async () => {
    const db = makeDb([])
    db.packagePurchase.findMany
      .mockResolvedValueOnce([]) // rama clienta
      .mockResolvedValueOnce([{ id: 'pp2', customer: { name: 'Ana' }, product: { name: 'Pack 5' }, business: { id: 'b1', name: 'Biz' } }])
    const res = await sendTransferReminders(now, db as never, deps as never)
    expect(sendPkgBusiness).toHaveBeenCalledWith('b1', expect.objectContaining({ productName: 'Pack 5' }))
    expect(res.packageBusinessSent).toBe(1)
  })

  it('si el envío a la clienta falla, libera el claim', async () => {
    sendPkgCustomer.mockRejectedValueOnce(new Error('smtp down'))
    const db = makeDb([])
    db.packagePurchase.findMany.mockResolvedValueOnce([basePurchase]).mockResolvedValueOnce([])
    const res = await sendTransferReminders(now, db as never, deps as never)
    expect(res.errors).toBe(1)
    // release: updateMany data con flag null
    expect(db.packagePurchase.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { transferReminderCustomerSentAt: null },
    }))
  })
})
```

(El `satisfies`/shape exacto del where se cubre con el test de drift del propio módulo — el unit valida comportamiento, no el literal.)

- [ ] **Step 2: Verificar que falla**

```bash
npx vitest run tests/unit/package-transfer-reminders.test.ts
```

Expected: FAIL (`packageCustomerSent` no existe; deps no aceptan `sendPkgCustomer`).

- [ ] **Step 3: Implementación**

En `src/lib/cron/transfer-reminders.ts`:

1. Imports nuevos:

```ts
import { declaredPkgTransferPaymentWhere } from '@/lib/bank-transfer/declared'  // sumar al import existente
import { sendPackageTransferReminderToCustomer, sendPackageTransferUnverifiedToBusiness } from '@/lib/notifications'  // sumar
import { getPackageConfirmationUrl } from '@/lib/business/urls'  // sumar al import existente
```

2. Tipos:

```ts
export interface TransferRemindersResult {
  customerSent: number
  businessSent: number
  packageCustomerSent: number
  packageBusinessSent: number
  skipped: number
  errors: number
}

interface Deps {
  sendCustomer: typeof sendTransferReminderToCustomer
  sendBusiness: typeof sendTransferReminderToBusiness
  sendPkgCustomer: typeof sendPackageTransferReminderToCustomer
  sendPkgBusiness: typeof sendPackageTransferUnverifiedToBusiness
}
```

3. Firma: `db: Pick<PrismaClient, 'booking' | 'packagePurchase'> = prisma`, default deps con los 2 nuevos; `result` inicializa los 2 contadores nuevos.

4. Claim-release para paquetes (junto a `releaseReminderClaim`):

```ts
async function releasePkgReminderClaim(
  db: Pick<PrismaClient, 'packagePurchase'>, id: string, field: ReminderField, now: Date,
) {
  await db.packagePurchase.updateMany({ where: { id, [field]: now }, data: { [field]: null } })
}
```

5. Al final de la función, antes del `return result`, las dos ramas (mismo patrón 3 fases que las de reservas):

```ts
  // ---- Paquetes: clienta (eligió transferencia, no declaró, hold por vencer) ----
  const pkgCustomerWhere = {
    status: 'pending',
    source: 'online',
    paymentMethod: 'Transferencia',
    transferReminderCustomerSentAt: null,
    holdExpiresAt: { gt: now, lte: addHours(now, CUSTOMER_REMINDER_HOURS_BEFORE_HOLD) },
    // Espejo del where de reservas: ni declarada ni con un MP en vuelo.
    payments: { none: { OR: [declaredPkgTransferPaymentWhere, { provider: 'mercado_pago', status: 'pending' }] } },
    business: { bankTransferAccount: { isEnabled: true, holdHours: { gt: CUSTOMER_REMINDER_HOURS_BEFORE_HOLD } } },
  } satisfies Prisma.PackagePurchaseWhereInput
  const pkgCustomer = await db.packagePurchase.findMany({
    where: pkgCustomerWhere,
    include: {
      product: { select: { name: true } },
      customer: { select: { name: true, email: true } },
      business: {
        select: {
          id: true, name: true, timezone: true, currency: true, slug: true, subdomain: true,
          bankTransferAccount: true,
        },
      },
    },
  })
  const pkgCustomerClaimed: typeof pkgCustomer = []
  for (const p of pkgCustomer) {
    if (!p.customer?.email || !p.business.bankTransferAccount || !p.holdExpiresAt) {
      result.skipped++
      continue
    }
    const claim = await db.packagePurchase.updateMany({
      where: { id: p.id, ...pkgCustomerWhere },
      data: { transferReminderCustomerSentAt: now },
    })
    if (claim.count === 0) { result.skipped++; continue }
    pkgCustomerClaimed.push(p)
  }
  await Promise.all(
    [...new Set(pkgCustomerClaimed.map((p) => p.business.id))]
      .filter((id) => !replyToByBiz.has(id))
      .map(async (id) => { replyToByBiz.set(id, await getBusinessReplyToEmail(id)) }),
  )
  await Promise.all(
    pkgCustomerClaimed.map(async (p) => {
      const acct = p.business.bankTransferAccount!
      try {
        const res = await sendNotificationSafely('package transfer reminder customer', () =>
          deps.sendPkgCustomer({
            businessName: p.business.name,
            businessTimezone: p.business.timezone || 'America/Santiago',
            customerName: p.customer.name,
            productName: p.product.name,
            amount: p.pricePaid,
            businessCurrency: p.business.currency || 'CLP',
            bankTransfer: toBankTransferEmailInfo(acct, p.holdExpiresAt!, getPackageConfirmationUrl(p.business, p.id)),
            customerEmail: p.customer.email!,
            businessReplyToEmail: replyToByBiz.get(p.business.id) ?? null,
          }),
        )
        if (res.success) result.packageCustomerSent++
        else {
          await releasePkgReminderClaim(db, p.id, 'transferReminderCustomerSentAt', now)
          result.skipped++
        }
      } catch {
        await releasePkgReminderClaim(db, p.id, 'transferReminderCustomerSentAt', now)
        logger.error('transfer_reminder.package_customer.failed', p.id)
        result.errors++
      }
    }),
  )

  // ---- Paquetes: dueña (declarada envejecida sin verificar) ----
  // Un paquete declarado no tiene verify-deadline (el sweep lo exime y el hold no
  // se extiende al declarar): sólo existe la rama "declaró hace >= 24h".
  const pkgBusinessWhere = {
    status: 'pending',
    transferReminderBusinessSentAt: null,
    payments: { some: { ...declaredPkgTransferPaymentWhere, createdAt: { lte: subHours(now, BUSINESS_REMINDER_HOURS_AFTER_DECLARE) } } },
  } satisfies Prisma.PackagePurchaseWhereInput
  const pkgBusiness = await db.packagePurchase.findMany({
    where: pkgBusinessWhere,
    include: {
      product: { select: { name: true } },
      customer: { select: { name: true } },
      business: { select: { id: true, name: true } },
    },
  })
  const pkgBusinessClaimed: typeof pkgBusiness = []
  for (const p of pkgBusiness) {
    const claim = await db.packagePurchase.updateMany({
      where: { id: p.id, ...pkgBusinessWhere },
      data: { transferReminderBusinessSentAt: now },
    })
    if (claim.count === 0) { result.skipped++; continue }
    pkgBusinessClaimed.push(p)
  }
  await Promise.all(
    pkgBusinessClaimed.map(async (p) => {
      try {
        const results = await sendMultiNotificationSafely('package transfer unverified business', () =>
          deps.sendPkgBusiness(p.business.id, {
            businessName: p.business.name,
            customerName: p.customer?.name ?? 'la clienta',
            productName: p.product.name,
          }),
        )
        if (results.some((r) => r.success)) result.packageBusinessSent++
        else {
          await releasePkgReminderClaim(db, p.id, 'transferReminderBusinessSentAt', now)
          result.skipped++
        }
      } catch {
        await releasePkgReminderClaim(db, p.id, 'transferReminderBusinessSentAt', now)
        logger.error('transfer_reminder.package_business.failed', p.id)
        result.errors++
      }
    }),
  )
```

Notas de integración: `replyToByBiz` ya existe en el scope (fase 2 de reservas) — reusarlo con el `.filter` de arriba evita re-resolver negocios repetidos. El route del cron no cambia (loggea el JSON del result, que ahora trae 2 campos más). Otros consumidores de `TransferRemindersResult` (si `tsc` los marca) sólo suman los campos nuevos.

- [ ] **Step 4: Verificar unit**

```bash
npx vitest run tests/unit/package-transfer-reminders.test.ts tests/unit/transfer-reminders.test.ts
```

Expected: ambos PASS (el archivo viejo no debe romperse — si sus asserts construyen `TransferRemindersResult` literal, sumar los 2 campos).

- [ ] **Step 5: Test de integración** (`tests/integration/package-transfer-reminders.test.ts`, seed espejo de `packages.transfer.integration.test.ts` con `BIZ = 'pkgrem-biz-1'`, `USER = 'pkgrem-user-1'`, subdomain `pkgrembiz`, y los mismos mocks de auth/rate-limit; deps inyectadas con `vi.fn()`):

```ts
  it('recordatorio clienta: claim + envío una sola vez, y no toca declaradas', async () => {
    const { createPackagePurchase, declarePackageTransfer } = await import('@/server/actions/packages-checkout')
    const { sendTransferReminders } = await import('@/lib/cron/transfer-reminders')
    const mk = () => createPackagePurchase({
      packageProductId: productId, name: 'Cli Rem', phone: '+56900000010', acceptedTerms: true, method: 'transfer',
    })
    const { purchaseId: abandoned } = await mk()
    // Ponerla dentro de la ventana de 3h.
    await prisma.packagePurchase.update({ where: { id: abandoned }, data: { holdExpiresAt: new Date(Date.now() + 2 * 3600_000) } })

    const sendPkgCustomer = vi.fn().mockResolvedValue({ success: true })
    const sendPkgBusiness = vi.fn().mockResolvedValue([{ success: true }])
    const deps = {
      sendCustomer: vi.fn().mockResolvedValue({ success: true }),
      sendBusiness: vi.fn().mockResolvedValue([{ success: true }]),
      sendPkgCustomer, sendPkgBusiness,
    }
    const r1 = await sendTransferReminders(new Date(), prisma, deps as never)
    expect(r1.packageCustomerSent).toBe(1)
    // Segunda corrida: flag puesto → no re-envía.
    const r2 = await sendTransferReminders(new Date(), prisma, deps as never)
    expect(r2.packageCustomerSent).toBe(0)
    expect(sendPkgCustomer).toHaveBeenCalledTimes(1)

    // Declarada: no cae en la rama clienta aunque el hold esté por vencer.
    await declarePackageTransfer({ purchaseId: abandoned })
    await prisma.packagePurchase.update({ where: { id: abandoned }, data: { transferReminderCustomerSentAt: null } })
    const r3 = await sendTransferReminders(new Date(), prisma, deps as never)
    expect(r3.packageCustomerSent).toBe(0)
  })

  it('recordatorio dueña: declarada hace >=24h dispara una sola vez', async () => {
    const { createPackagePurchase, declarePackageTransfer } = await import('@/server/actions/packages-checkout')
    const { sendTransferReminders } = await import('@/lib/cron/transfer-reminders')
    const { purchaseId } = await createPackagePurchase({
      packageProductId: productId, name: 'Cli Rem', phone: '+56900000010', acceptedTerms: true, method: 'transfer',
    })
    await declarePackageTransfer({ purchaseId })
    // Envejecer la declaración.
    await prisma.payment.updateMany({
      where: { packagePurchaseId: purchaseId, provider: 'manual' },
      data: { createdAt: new Date(Date.now() - 25 * 3600_000) },
    })
    const sendPkgBusiness = vi.fn().mockResolvedValue([{ success: true }])
    const deps = {
      sendCustomer: vi.fn(), sendBusiness: vi.fn(),
      sendPkgCustomer: vi.fn(), sendPkgBusiness,
    }
    const r1 = await sendTransferReminders(new Date(), prisma, deps as never)
    expect(r1.packageBusinessSent).toBe(1)
    const r2 = await sendTransferReminders(new Date(), prisma, deps as never)
    expect(r2.packageBusinessSent).toBe(0)
    expect(sendPkgBusiness).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 6: Verificar integración**

```bash
npx vitest run tests/integration/package-transfer-reminders.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add src/lib/cron/transfer-reminders.ts tests/unit/package-transfer-reminders.test.ts tests/integration/package-transfer-reminders.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "feat(packages): recordatorios de transferencia de paquete (clienta + dueña)"
```

---

### Task 9: /mi muestra las compras por transferencia pendientes

**Files:**
- Modify: `src/lib/loyalty/card-data.ts` (query + return)
- Modify: `src/components/loyalty/loyalty-card.tsx` (sección nueva)
- Test: `tests/unit/loyalty-card-pending-packages.test.tsx` (crear)

- [ ] **Step 1: Test que falla**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

import { LoyaltyCard } from '@/components/loyalty/loyalty-card'
import type { LoyaltyCardData } from '@/lib/loyalty/card-data'

const baseData = {
  config: null, balance: 0, history: [], catalog: [], grants: [], packages: [], referralUrl: null,
  pendingPackages: [],
} as unknown as LoyaltyCardData

describe('LoyaltyCard — paquetes por confirmar', () => {
  it('lista una pending sin declarar con "Te falta transferir" y link de retorno', () => {
    const data = {
      ...baseData,
      pendingPackages: [{ id: 'pp1', productName: 'Pack 5', declared: false, resumeUrl: 'https://biz.agendita.cl/paquetes/confirmation?purchaseId=pp1' }],
    } as unknown as LoyaltyCardData
    const html = renderToStaticMarkup(
      <LoyaltyCard customerName="Ana" business={{ name: 'Biz', logoUrl: null }} data={data} redeemAction={async () => {}} />,
    )
    expect(html).toContain('Pack 5')
    expect(html).toContain('Te falta transferir')
    expect(html).toContain('purchaseId=pp1')
  })

  it('declarada muestra "En verificación"', () => {
    const data = {
      ...baseData,
      pendingPackages: [{ id: 'pp1', productName: 'Pack 5', declared: true, resumeUrl: 'https://x/paquetes/confirmation?purchaseId=pp1' }],
    } as unknown as LoyaltyCardData
    const html = renderToStaticMarkup(
      <LoyaltyCard customerName="Ana" business={{ name: 'Biz', logoUrl: null }} data={data} redeemAction={async () => {}} />,
    )
    expect(html).toContain('En verificación')
  })

  it('sin pendientes no renderiza la sección', () => {
    const html = renderToStaticMarkup(
      <LoyaltyCard customerName="Ana" business={{ name: 'Biz', logoUrl: null }} data={baseData} redeemAction={async () => {}} />,
    )
    expect(html).not.toContain('Paquetes por confirmar')
  })
})
```

(Si `LoyaltyCard` no usa `useRouter` directamente, el mock de `next/navigation` es inofensivo — dejarlo igual: `ReferralShare` u otro hijo puede usarlo.)

- [ ] **Step 2: Verificar que falla**

```bash
npx vitest run tests/unit/loyalty-card-pending-packages.test.tsx
```

Expected: FAIL (`pendingPackages` no existe / sección no renderiza).

- [ ] **Step 3: card-data**

En `src/lib/loyalty/card-data.ts`:

```ts
import { declaredPkgTransferPaymentWhere } from '@/lib/bank-transfer/declared'
import { getBookingFunnelUrl, getPackageConfirmationUrl } from '@/lib/business/urls'
```

Sumar al `Promise.all` (y a la destructuración) una séptima query:

```ts
    // Compras por transferencia aún no confirmadas: la clienta necesita una vía de
    // re-entrada (retomar/declarar) — las pending de MP (hold 30 min) son ruido.
    prisma.packagePurchase.findMany({
      where: { customerId: customer.id, status: 'pending', paymentMethod: 'Transferencia' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        product: { select: { name: true } },
        payments: { where: declaredPkgTransferPaymentWhere, select: { id: true } },
      },
    }),
```

y en el `return`:

```ts
  const pendingPackages = pendingPurchases.map((p) => ({
    id: p.id,
    productName: p.product.name,
    declared: p.payments.length > 0,
    resumeUrl: getPackageConfirmationUrl(customer.business, p.id),
  }))

  return { config, balance, history, catalog, grants, packages, pendingPackages, referralUrl }
```

- [ ] **Step 4: LoyaltyCard**

En `src/components/loyalty/loyalty-card.tsx`, destructurar `pendingPackages` y agregar la sección ANTES de "Mis paquetes":

```tsx
      {pendingPackages.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Paquetes por confirmar</h2>
          <ul className="space-y-2">
            {pendingPackages.map(p => (
              <li key={p.id} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                <div className="font-medium text-amber-800">{p.productName}</div>
                <div className="text-amber-700">{p.declared ? 'En verificación' : 'Te falta transferir'}</div>
                <a href={p.resumeUrl} className="font-semibold text-amber-800 underline">
                  {p.declared ? 'Ver estado' : 'Retomar compra'}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
```

- [ ] **Step 5: Verificar + tsc**

```bash
npx vitest run tests/unit/loyalty-card-pending-packages.test.tsx && npx tsc --noEmit | grep '^src/'
```

Expected: PASS, 0 errores (LoyaltyCardData es `Awaited<ReturnType<...>>`, se propaga solo).

- [ ] **Step 6: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add src/lib/loyalty/card-data.ts src/components/loyalty/loyalty-card.tsx tests/unit/loyalty-card-pending-packages.test.tsx
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "feat(mi): compras de paquete por transferencia pendientes visibles en la tarjeta"
```

---

### Task 10: Gate final del PR

**Files:** ninguno nuevo (verificación + PR)

- [ ] **Step 1: Suite completa de unit + integración**

```bash
npx vitest run
```

Expected: verde completo. (Integración requiere `agendita-test-pg` en :5433.)

- [ ] **Step 2: Tipos y lint**

```bash
npx prisma generate && npx tsc --noEmit | grep '^src/'
npx eslint src tests --max-warnings 0 2>&1 | tail -5
```

Expected: 0 errores tsc en `src/`; 0 warnings/errores eslint nuevos (comparar contra main si el repo tiene deuda preexistente).

- [ ] **Step 3: /simplify** — correr el skill `/simplify` sobre el diff de la rama y aplicar lo razonable.

- [ ] **Step 4: Code review 5-finders con verificación adversarial** — regla de sesión: review multi-agente (5 finders con lentes distintas + verificación adversarial de cada hallazgo) sobre `git diff main...HEAD`; corregir confirmados.

- [ ] **Step 5: Push + PR (SIN auto-merge)**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 push -u origin claude/package-transfer-resume
gh pr create --repo rrzu777/agendita --base main --title "feat(packages): retomar transferencia de paquete abandonada (follow-up 3 B4b-3)" --body "..."
```

El body del PR resume las 4 piezas + link al spec. **Mergear SOLO con OK explícito del usuario.**

---

## Self-review del plan (hecho al escribirlo)

- **Cobertura del spec:** §3→Task 1-2, §4→Task 3+5+6, §5→Task 4+6, §6→Task 7-8, §7→Task 9, §8→tests distribuidos por task + gate. Los 4 hallazgos de integración de la sesión (MP en vuelo, reuse re-arma flag, URL absoluta en /mi, append-only en email-provider) están en Tasks 3, 2, 9 y 7 respectivamente.
- **Sin placeholders:** todo step de código lleva el código; los puntos donde el implementador debe verificar contra el archivo real (mocks del create.test, props exactas del componente extraído, helpers de templates) están marcados con la instrucción concreta de qué mirar.
- **Consistencia de nombres:** `awaiting_transfer`, `PackageTransferPanel`, `PackageTransferInstructions`, `sendPackageTransferReminderToCustomer`, `sendPackageTransferUnverifiedToBusiness`, `packageCustomerSent`/`packageBusinessSent`, `pendingPackages` — usados igual en todas las tasks.
