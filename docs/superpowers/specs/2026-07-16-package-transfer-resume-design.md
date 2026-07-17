# Retomar transferencia de paquete abandonada — Diseño

**Fecha:** 2026-07-16 · **Estado:** aprobado (alcance y decisiones del usuario en esta sesión)
**Contexto:** follow-up 3 de B4b-3 ([PR #76](https://github.com/rrzu777/agendita/pull/76), squash `4137e83`): "si la clienta cierra la pestaña tras elegir transferencia y antes de declarar, la compra queda pending y el cron la expira (no hay affordance de 'retomar' como en reservas)". Las reservas ya resuelven esto con `/book/confirmation` activa (`src/app/book/confirmation/transfer-panel.tsx`) + cron `transfer-reminders`; los paquetes no tienen ninguna de las dos piezas.

## 1. Estado actual (gaps verificados)

- El wizard de paquetes solo redirige a `/paquetes/confirmation` **después** de declarar (`package-checkout.tsx:98`). Si la clienta cierra antes, no tiene URL de re-entrada.
- `/paquetes/confirmation` es **pasiva**: un `pending` sin declarar cae en `'pending'` → "Procesando tu pago" (copy falso: no pagó nada), sin datos bancarios ni botón.
- No se sabe qué método eligió hasta que declara: el Payment se crea recién en `declarePackageTransfer`. Una compra `pending` sin Payments es ambigua (¿transferencia abandonada o MP nunca iniciado?).
- `createPackagePurchase` ya **reusa** la compra pending viva del mismo producto (reintentos), pero exige rehacer el form.
- `/mi` filtra paquetes `status:'active'` (`card-data.ts:58`): la compra pendiente es invisible para la clienta.
- `transfer-reminders.ts` es booking-only. Una compra **declarada** que la dueña nunca verifica queda `pending` para siempre (el sweep la exime a propósito — fix zombie de #77) con el banner como única señal.
- `expired` es terminal para paquetes: el copy dice "iniciá la compra de nuevo" sin link. Para reservas existe `reviveBooking` (owner-gated porque reabrir toca cupo); un paquete **no bloquea cupo**, lo que habilita revive self-service.

## 2. Decisiones del usuario

1. **Alcance completo (4 piezas):** confirmation activa (núcleo) + pending visible en `/mi` + recordatorios de paquete + revivir compra expirada.
2. **Revive self-service:** la clienta revive la expirada declarando desde la confirmation (sin intervención de la dueña, que igual confirma/rechaza después). No hay botón "revivir" de la dueña.
3. **Enfoque A aprobado:** espejo de reservas, rama por superficie (como B4b-3). Nada de unificar la maquinaria booking/paquete (eso sería mezclar el follow-up 4 — factory bt-* — que queda fuera).

## 3. Migración + marcador de método

- `PackagePurchase` gana `transferReminderCustomerSentAt DateTime?` y `transferReminderBusinessSentAt DateTime?` (espejo de los flags de `Booking` que usa `transfer-reminders.ts`).
- `createPackagePurchase` setea `paymentMethod: 'Transferencia'` en el create cuando `method === 'transfer'` (y `null` para MP, como hoy). La **rama de reuse** también lo actualiza junto con el hold (la clienta puede volver cambiando de método: reuse con `method='mp'` limpia a `null`, con `'transfer'` lo setea).
- Verificado seguro: `PackagePurchase.paymentMethod` hoy solo lo escribe la venta manual de la dueña (`packages.ts:97`) y ningún flujo de plata lo lee (los refunds deciden método por el Payment; `activatePackagePurchaseInTx` solo toca `status`).
- Landmines de migración vigentes: podar del `migrate diff` los statements de ramas hermanas; si se aplica a mano vía `db execute`, correr `migrate resolve --applied`.

## 4. Estado `awaiting_transfer` + confirmation activa

- `derivePackageConfirmationState` (`src/lib/payments/package-confirmation-state.ts`) gana `'awaiting_transfer'`: `status === 'pending'` **y** `paymentMethod === 'Transferencia'` **y** ningún Payment declarado (`isDeclaredPkgTransferPayment`). El `DeriveInput` suma `paymentMethod` y amplía `payments` a `{ status, provider, providerPaymentId }` (la página ya hace el `findUnique`; solo se amplía el select).
  - Orden de evaluación: los terminales (`active`/`expired`/`refunded`/`rejected`) siguen primero; `awaiting_transfer` se evalúa antes que la derivación por pagos.
  - Un `pending` **declarado** sigue cayendo en `'pending'`; el copy actual ("Estamos procesando tu pago. Te confirmaremos cuando se acredite") ya sirve para transferencia declarada, no cambia.
- `/paquetes/confirmation` en `awaiting_transfer` muestra copy "Te falta transferir" + **`PackageTransferPanel`** (client component nuevo, espejo de `transfer-panel.tsx` de reservas): datos bancarios + monto + deadline + "Ya transferí" → `declarePackageTransfer({ purchaseId })` → `router.refresh()`. La página (server) resuelve `getBankTransferInfo(purchase.businessId)` y pasa `amount = pricePaid`, `deadline = holdExpiresAt`, `timezone` del negocio.
- `PackageTransferInstructions` se **extrae** de `package-checkout.tsx` a `src/components/packages/package-transfer-instructions.tsx` (componente compartido); el wizard y el panel de confirmation usan la misma. El flujo del wizard no cambia (paso inline + redirect post-declare, como hoy).
- Sin declarar no hay comprobante (igual que hoy: `declarePackageTransfer` es deliberadamente sin comprobante).

## 5. Revive self-service en `declarePackageTransfer`

- La action acepta también `status === 'expired'`, **solo si** `paymentMethod === 'Transferencia'` (compras MP expiradas o legacy con `paymentMethod` null: no retomables, se recompra).
- Guards de producto antes de la tx (query al `PackageProduct`): `isActive === true` **y** `product.price === purchase.pricePaid`. Si falla cualquiera → error "Este paquete cambió. Iniciá la compra de nuevo." (la confirmation en ese caso ni muestra el panel, ver abajo; el guard server-side es la red).
- En la tx, la rama expired reemplaza el CAS actual: `updateMany({ where: { id, status: 'expired' }, data: { status: 'pending', holdExpiresAt: now + holdHours de la cuenta, transferReminderCustomerSentAt: null, transferReminderBusinessSentAt: null } })`; `count === 0` → "Esta compra ya fue procesada." (carrera con otra pestaña/el sweep). La rama `pending` conserva el CAS existente sin cambios.
- El `holdHours` sale de `getBankTransferInfo(businessId)` (si el negocio deshabilitó transferencia mientras tanto → error, no retomable).
- El upsert del Payment declarado ya existente cubre ambas ramas; su rama `update` (hoy `{}`) pasa a reactivar por robustez: `{ status: 'pending', createdAt: now }` (una expirada normal no tiene Payment declarado — el sweep exime declaradas — pero si existiera `cancelled`, revivirlo con `createdAt: now` rehabilita el recordatorio de la dueña y refleja "declaró de nuevo"; espejo del fix A2 de `declareBankTransfer` en reservas: un Payment `approved` no se toca, el upsert no puede pisarlo porque el update solo corre en la rama del unique y el guard de status ya cortó si la compra no está pending/expired).
- La notificación a la dueña post-declare se manda igual en ambas ramas (misma `sendPackageTransferDeclaredToBusiness`).
- **La confirmation en `expired`:** si es retomable (paymentMethod Transferencia + producto activo + precio igual + transferencia del negocio habilitada) → copy "Tu compra expiró, pero podés retomarla" + el mismo `PackageTransferPanel` (el "Ya transferí" revive). Si no → copy actual + link al catálogo `/paquetes`.
- `rejected` sigue terminal: la dueña ya miró y dijo que no; re-declarar sería spam.

## 6. Recordatorios de paquete en `transfer-reminders`

Rama nueva en `src/lib/cron/transfer-reminders.ts`, mismas constantes exportadas y mismo patrón de claim CAS con where COMPLETO (re-afirmar todas las condiciones en el `updateMany` del flag, no solo el flag):

- **Clienta** (`transferReminderCustomerSentAt`): `status:'pending'`, `paymentMethod:'Transferencia'`, sin Payment declarado (`payments: { none: declaredPkgTransferPaymentWhere }`), `holdExpiresAt` en `(now, now + CUSTOMER_REMINDER_HOURS_BEFORE_HOLD]`, flag null, cuenta del negocio `isEnabled` con `holdHours > CUSTOMER_REMINDER_HOURS_BEFORE_HOLD`. Email "te falta transferir para tu paquete" con link a `getPackageConfirmationUrl(business, purchaseId)`.
- **Dueña** (`transferReminderBusinessSentAt`): `status:'pending'` con Payment declarado `createdAt <= now - BUSINESS_REMINDER_HOURS_AFTER_DECLARE`, flag null. Email "tenés una transferencia de paquete sin verificar" con link al dashboard. Los paquetes **no tienen verify-deadline** (el hold no se extiende al declarar y el sweep exime declaradas), así que solo existe la rama 24h-post-declare — no hay espejo de la rama `BEFORE_VERIFY` de reservas.
- El revive (§5) resetea ambos flags → una compra revivida vuelve a tener recordatorios.
- Dos templates de email nuevos espejo de los de reservas: `sendPackageTransferReminderToCustomer` y `sendPackageTransferUnverifiedToBusiness`, vía los helpers existentes de `@/lib/notifications`.
- Mismo cron route existente (`/api/cron/transfer-reminders` llama la función extendida). Errores de email best-effort como hoy (claim ya hecho, no re-envía).

## 7. `/mi` muestra pending

- `getMyCard` (`src/lib/loyalty/card-data.ts`) agrega una query de `packagePurchase` con `status:'pending'` y `paymentMethod:'Transferencia'` (las pending de MP con hold de 30 min son ruido y se autolimpian), select mínimo: producto, `holdExpiresAt`, y si tiene Payment declarado (para el badge).
- La tarjeta lista esas compras con badge "Te falta transferir" (sin declarar) o "En verificación" (declarada), linkeando a `/paquetes/confirmation?purchaseId=…` (misma resolución de URL relativa/absoluta que usa la página según tenant).
- Las `expired` **no** se listan en `/mi` (la re-entrada a una expirada retomable es el email de recordatorio previo o el link de confirmation que ya tenga; listar expiradas viejas en la tarjeta es ruido permanente).

## 8. Tests

- **Unit:** `derivePackageConfirmationState` con `awaiting_transfer` (pending+transfer sin declarar / declarado→pending / MP→pending); guards del revive (producto inactivo, precio cambiado, transferencia deshabilitada, CAS count 0); where de reminders de paquete (anti-drift de condiciones, espejo de los tests booking).
- **Integración** (Postgres local `agendita-test-pg` :5433; verificar columnas reales antes de `migrate resolve`): expired → declare revive → pending + Payment declarado + flags reset → `confirmPackageTransfer` → active con grants; reminder clienta claim idempotente (segunda corrida no re-envía); reminder dueña 24h; revive con precio cambiado falla sin tocar la fila.
- **Component** (mock de `next/navigation` — landmine conocida): confirmation en `awaiting_transfer` (datos bancarios + botón), en `expired` retomable vs no retomable; badges de `/mi`.
- **e2e:** ninguno nuevo (suite no-required y date-dependent; el flujo queda cubierto por integración+component).

## 9. Fuera de alcance

- **Factory bt-*** (follow-up 4 de B4b-3): refactor aparte, siguiente rebanada.
- Comprobante de transferencia para paquetes (las reservas lo tienen; `declarePackageTransfer` sigue sin comprobante a propósito).
- Botón "revivir" de la dueña para paquetes, verify-deadline para declaradas de paquete, y recordatorios repetidos (una sola vez por flag).
- Webpay / API bancaria (externos, bloqueados por credenciales).
