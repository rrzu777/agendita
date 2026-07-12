# Comprobante de transferencia (upload) — Diseño

**Fecha:** 2026-07-12
**Feature:** #4 del backlog bank-transfer (comprobante / upload).
**Estado:** diseño aprobado, pendiente de revisión del spec escrito → writing-plans.

## Objetivo

Permitir que la clienta adjunte un comprobante (imagen o PDF) al declarar una transferencia bancaria —
tanto el abono inicial como el saldo restante—, y que la dueña lo vea desde el dashboard para verificar
más rápido, sin corromper el ledger ni las superficies existentes de transferencia. El almacenamiento es
**Cloudflare R2** (S3-compatible), con subida directa desde el navegador vía URLs prefirmadas.

## Decisiones del usuario

1. **Obligatoriedad: configurable por negocio.** Nuevo toggle `Business.requireTransferProof` que la dueña
   activa en Ajustes → Pagos. Por defecto `false` (aditivo, no rompe el flujo actual).
2. **Alcance: abono y saldo, en todas las superficies.** Aplica al declarar el abono (wizard +
   `/book/confirmation`) y al declarar el saldo (`/book/confirmation`). Un solo mecanismo reusado en los tres
   puntos (todos comparten el componente `TransferDetails`).
3. **Archivo: 1 solo, imagen (JPG/PNG/WebP) o PDF, ≤ 5 MB.**
4. **Enfoque técnico A — URLs prefirmadas, bucket privado.** Subida directa navegador → R2; validación
   autoritativa por `HEAD` server-side; visualización de la dueña por GET prefirmada de vida corta.
5. **`attachProof`** disponible: adjuntar/reemplazar el comprobante después de haber declarado.
6. **"Comprobante adjuntado ✓"** persistente para la clienta en el panel de confirmación.

## Alcance

**Dentro de v1:**
- Columnas `Payment.proofKey` / `Payment.proofContentType` (1:1 con el Payment declarado).
- Setting `Business.requireTransferProof`.
- Cliente R2 (`@aws-sdk/client-s3` + presigner) con inyección de dependencias para tests.
- Server actions: `createProofUploadUrl` (presign), `attachProof`, y `proofKey` opcional en
  `declareBankTransfer` / `declareBalanceTransfer`.
- Ruta de visualización owner-only (`/dashboard/transfers/proof/[paymentId]`).
- UI: control de adjunto en `TransferDetails`; "Ver comprobante" en `PendingTransfersSection` /
  `VerifyTransferDialog`; checkbox en Ajustes; "adjuntado ✓" en la page de confirmación.
- Gate de disponibilidad por config de R2 (`isProofUploadAvailable`).
- Emails "declaró" ganan línea "Adjuntó comprobante".
- Limpieza de objetos por **regla de lifecycle de R2** (no borrado transaccional).

**Fuera de v1:**
- Sniff de magic-bytes (validación profunda de contenido). Mitigado sirviendo con content-type del
  allowlist + `Content-Disposition`.
- Varios archivos por declaración.
- Borrado transaccional del objeto en R2 al rechazar/expirar/cancelar.
- Comprobante para pagos de **paquete** (`Payment.packagePurchaseId`, #72) — flujo aparte, sin UI pública aún.
- e2e nuevo (la suite e2e es no-requerida y frágil; cobertura vía integration).

## Arquitectura

### Modelo de datos (migración aditiva)

```prisma
model Business {
  // ...
  requireTransferProof Boolean @default(false)
}

model Payment {
  // ...
  proofKey         String?   // clave del objeto en R2: proofs/<businessId>/<bookingId>/<kind>
  proofContentType String?   // image/jpeg | image/png | image/webp | application/pdf
}
```

No hay tabla nueva: el comprobante es 1:1 con el Payment declarado (`bt-declared:` o `bt-balance:`).
`Payment.bookingId` es nullable desde #72 (Payment polimórfico), pero los bt-* siguen siendo booking-scoped;
esta feature no toca el path de paquetes.

Migración timestamped nueva bajo `prisma/migrations/` (convención aditiva; última:
`20260712120100_payment_package_unique`). Aplicar a la DB compartida con `db execute` +
`migrate resolve --applied` (ver landmine [[migrate-via-db-execute-needs-resolve]]).

### Cliente R2 — `src/lib/storage/r2.ts`

Módulo lib plano (no `'use server'`). Un cliente S3 apuntando al endpoint de R2, construido lazy y
never-throw a nivel de import (mirror de `getResend()` / `getAccessToken()`):

```ts
export interface ProofStorage {
  presignUpload(key: string, contentType: string): Promise<string>   // PUT, ~2 min
  presignDownload(key: string, contentType: string): Promise<string> // GET, ~60 s, con response-content-type + disposition
  head(key: string): Promise<{ contentLength: number; contentType: string | null } | null> // null si no existe
}

export function getProofStorage(): ProofStorage | null // null si R2 no está configurado
export function isProofUploadAvailable(): boolean       // never-throws; para gatear la feature
```

**Env (`src/lib/env.ts`, estilo warning pareado como Resend, no error duro):**
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Endpoint derivado del account id
(`https://<account_id>.r2.cloudflarestorage.com`). Provisión manual del usuario (bucket privado + CORS PUT
desde el dominio de la app + los previews de Vercel).

**Clave determinística:** `proofs/<businessId>/<bookingId>/<kind>` (`kind` = `deposit` | `balance`).
Re-subir sobrescribe el mismo objeto → sin huérfanos por reintento o `attachProof`.

### Constantes compartidas — `src/lib/storage/proof.ts` (módulo lib plano)

```ts
export const PROOF_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const
export const PROOF_MAX_BYTES = 5 * 1024 * 1024
export function proofKey(businessId: string, bookingId: string, kind: 'deposit' | 'balance'): string
export function isAllowedProofType(t: string): boolean
```

## Flujos

### Subida (cliente → presign → R2 → declare)

El control de adjunto vive en `TransferDetails` (`src/components/booking/transfer-details.tsx`), compartido
por wizard-abono (`step-payment.tsx:549`), confirmation-abono y confirmation-saldo (vía `TransferPanel`).

1. **Elegir archivo.** `<input accept="image/jpeg,image/png,image/webp,application/pdf">`. Validación
   client-side: tipo en `PROOF_ALLOWED_TYPES` y tamaño ≤ `PROOF_MAX_BYTES`. Falla → error inline, no sube.
2. **Presign.** Cliente → `createProofUploadUrl(bookingId, kind, contentType)`. El action: rate-limit
   (`'proof-upload-url'`), verifica que R2 está disponible, valida `contentType`, verifica elegibilidad de la
   reserva (mismo criterio que el declare del `kind`), devuelve `{ uploadUrl, key }`. La PUT prefirmada fija
   el `Content-Type` firmado.
3. **PUT directo a R2.** `fetch(uploadUrl, { method:'PUT', body:file, headers:{'Content-Type': file.type} })`.
   El navegador debe mandar **exactamente** el content-type firmado o R2 responde `SignatureDoesNotMatch`.
   Spinner de progreso; error → reintento (misma clave).
4. **Declarar con la clave.** `declareBankTransfer(bookingId, { proofKey, proofContentType })` (idem
   `declareBalanceTransfer`). El server hace **`HEAD` a R2**: existe + `ContentLength ≤ 5 MB` +
   `ContentType` en allowlist. Falla → error, no registra la declaración. Pasa → guarda
   `proofKey`/`proofContentType` en el Payment (create o update) en la misma tx.

**Por qué el HEAD:** la presigned PUT fija el tipo pero no el tamaño; el HEAD post-subida es la red de
seguridad autoritativa. La clienta no puede declarar con una clave que no subió.

### `attachProof` (adjuntar/reemplazar tras declarar)

`attachProof(bookingId, kind, { proofKey, proofContentType })`: rate-limit + HEAD de validación + update del
Payment pending (`proofKey`/`proofContentType`). Cierra el callejón del early-return idempotente del declare
(que retorna antes de escribir el proof cuando ya está pending). Solo opera sobre un Payment declarado
existente en estado pending.

### Write-side: no perder el comprobante en re-declare (gap de corrección)

Las rutas de reactivación de `declareBankTransfer` (bank-transfer-public.ts:99-102) y `declareBalanceTransfer`
(:220-225) hoy actualizan `status/amount/createdAt`. **Deben** también escribir `proofKey`/`proofContentType`
(el nuevo, o `null` para limpiar un comprobante viejo de una declaración muerta). Sin esto, una reactivación
tras revivir arrastra el comprobante stale y una re-subida se pierde.

### Gate configurable (`requireTransferProof`)

- **Lectura pública (choke point único):** ensanchar `getBankTransferInfo` (bank-transfer-public.ts:21-26)
  para traer `business.requireTransferProof` por relación, y ensanchar `BankTransferPublicInfo`
  (public-info.ts:17). El flag viaja por `bankInfo` a las tres superficies (el wizard ya lo tiene en mano
  antes de declarar; no hay round-trip extra).
- **`TransferDetails`** recibe `requireProof: boolean`; muestra "Comprobante obligatorio" y **deshabilita**
  "Ya transferí" hasta que la subida termine.
- **Server autoritativo:** si `requireTransferProof` está activo, `declareBankTransfer` /
  `declareBalanceTransfer` **rechazan** sin un `proofKey` válido (HEAD ok).
- **Reservas declaradas antes** de prender el toggle no se tocan (el gate corre solo al declarar).
- **Gate de disponibilidad:** si R2 no está configurado (`isProofUploadAvailable() === false`), el checkbox
  "exigir comprobante" se **oculta** en Ajustes y el control de subida **no aparece** en `TransferDetails`.
  Evita que la dueña exija algo que la plataforma no puede almacenar y brickee el declare.

### Persistencia del setting

`requireTransferProof` es de `Business`, no de `BankTransferAccount`, así que **no** puede ir en el upsert de
`saveBankTransferAccount`. Nuevo action dedicado `setRequireTransferProof(value)` (gemelo de
`setBankTransferEnabled`, bank-transfer-settings.ts). El form (`bank-transfer-form.tsx`) recibe el valor
sembrado desde la page (`settings/payments/page.tsx`, que ya tiene `userData.business`). Zod en el módulo lib
plano `schema.ts` (respeta [[use-server-export-boundary-pitfall]]).

### Visualización de la dueña

- **Ruta `/dashboard/transfers/proof/[paymentId]` (route handler GET):** verifica sesión de dueña + que el
  Payment pertenece a un negocio suyo. Ok → presigned GET (~60 s) + `redirect()`. No autorizada → 404.
- La presigned GET se firma con **`response-content-type`** forzado al valor del allowlist y
  **`response-content-disposition: inline; filename="comprobante"`** — el navegador nunca interpreta el objeto
  como HTML ejecutable aunque los bytes reales lo sean (mitiga la confianza en el content-type del cliente).
- **Threading (superficie única de lectura = `getBookings` → `PendingTransfersSection`):**
  - `bookings.ts:195-196`: agregar `proofKey: true, proofContentType: true` al select de `payments`.
  - `dashboard/bookings/page.tsx:226-242`: mapear `proofKey`/`proofContentType` al `PendingTransferItem`.
  - `pending-transfers-section.tsx:14-24`: agregar los dos campos al interface; botón "Ver comprobante" en
    el cluster de acciones; pasar props a `VerifyTransferDialog`.
  - `verify-transfer-dialog.tsx`: props nuevas; imagen embebida (si `proofContentType` es imagen) o enlace
    "Ver comprobante (PDF)".
- `getPayments`/`getPaymentsByBooking` son código muerto (sin consumidores) y la page "Pagos" muestra ledger,
  no Payments → **no se tocan**.

### "Comprobante adjuntado ✓" para la clienta

- `book/confirmation/page.tsx:43`: agregar `proofKey` al select de `booking.payments`.
- `deriveConfirmationState` (confirmation-state.ts) y `deriveBalanceState` (balance-confirmation-state.ts):
  ensanchar el input y exponer si el Payment pending tiene `proofKey`.
- El panel muestra "Comprobante adjuntado ✓" cuando corresponde.

### Notificaciones

`hasProof?: boolean` en `BankTransferDeclaredEmailData` (types.ts:128-137, compartido por abono y saldo). Una
línea "Adjuntó comprobante" en los 4 templates (`bankTransferDeclaredBusinessHtml/Text`,
`balanceTransferDeclaredBusinessHtml/Text`). Poblado en los 2 call sites (bank-transfer-public.ts:132-141 y
:252-261). Sin link (la lleva al dashboard, que tiene auth).

## Ciclo de vida / limpieza

- **Sin borrado transaccional.** No se acopla la tx de Prisma a R2. Los objetos viven bajo `proofs/` y se
  limpian con una **regla de lifecycle de R2** (borrar objetos con antigüedad > 180 días), provisionada junto
  al bucket. Cubre huérfanos de subidas-sin-declarar, rechazos, expiraciones y el cascade-delete del Payment.
- Rechazar/expirar/cancelar **no** borra el comprobante activamente (evidencia para la dueña + barato).
- **Confirmado:** ningún sweep (`expireStaleHolds`, autolimpieza de `recalcBookingFromPayments`,
  `updateBookingStatus`, `cancelBookingInTx`) borra Payments — solo flipean `status` con `updateMany`. El
  `proofKey` sobrevive.

## Seguridad

- Flujo público sin sesión: identidad = `bookingId` (cuid impredecible) + rate-limit, mismo modelo que
  `payments.ts` / los declares actuales.
- **Sobrescritura antes de declarar:** clave determinística + presign público ⇒ alguien con el `bookingId`
  puede pisar el comprobante legítimo. Acotado por el secreto del cuid + rate-limit. Aceptado.
- **Confianza en el content-type del cliente:** el HEAD reporta el tipo que el navegador puso en el PUT, no
  lo que dicen los bytes. Mitigado sirviendo siempre con content-type del allowlist + `Content-Disposition`.
- **Tamaño:** la presigned PUT no puede limitarlo; el HEAD post-subida rechaza el *declare* de un objeto
  gigante; el lifecycle de R2 barre el objeto almacenado. (Se descartó presigned POST con
  `content-length-range` por complejidad de cliente; el vector está acotado.)
- **Visualización:** bucket privado; solo la dueña autenticada obtiene una GET prefirmada de vida corta.

## Interacción con "revivir" (#2)

`reviveBooking` modo `confirm` (dueña) saltea el declare → sin gate de comprobante (correcto: dueña confiable,
registra el pago por el flujo manual). Modo `reopen` (clienta re-declara) sí pasa por `declareBankTransfer`
→ el gate de comprobante aplica si está activo. Asimetría esperada y explícita.

## Testing

- **Unit:** `r2.ts` con cliente S3 mockeado (presign determinístico; HEAD stub ok/oversize/tipo-inválido/
  inexistente); `isProofUploadAvailable` con env presente/ausente (harness `payment-factory.test.ts`);
  helpers de `proof.ts` (allowlist, tamaño, derivación de clave).
- **Component:** `TransferDetails` con `requireProof` on/off (botón bloqueado hasta subir), estados de
  subida/error, "adjuntado ✓"; "Ver comprobante" en `PendingTransfersSection` según `proofKey`/tipo
  (`renderToStaticMarkup` + mock `next/navigation`, ver [[component-tests-mock-next-navigation]]).
- **Integration:** `declareBankTransfer`/`declareBalanceTransfer` con y sin `proofKey`; gate
  `requireTransferProof` on/off; HEAD ok/falla; `attachProof` sobre pending; reactivación limpia/reemplaza el
  proof; idempotencia intacta. El cliente R2 se inyecta vía `deps` (patrón `expireStaleHolds`) → CI nunca toca
  R2 real.
- **Sin e2e nuevo.**

## Módulos / archivos

- **Nuevos:** `src/lib/storage/r2.ts`, `src/lib/storage/proof.ts`, `src/app/dashboard/transfers/proof/[paymentId]/route.ts`.
- **Modificados:** `prisma/schema.prisma` (+migración); `src/lib/env.ts`; `src/lib/rate-limit.ts`;
  `src/server/actions/bank-transfer-public.ts` (`createProofUploadUrl`, `attachProof`, `proofKey` en declares,
  `getBankTransferInfo` ensanchado); `src/lib/bank-transfer/public-info.ts`; `src/server/actions/bank-transfer-settings.ts`
  (`setRequireTransferProof`) + `src/lib/bank-transfer/schema.ts`; `src/app/dashboard/settings/payments/{page.tsx,bank-transfer-form.tsx}`;
  `src/components/booking/transfer-details.tsx`; `src/components/booking/step-payment.tsx`;
  `src/app/book/confirmation/{page.tsx,transfer-panel.tsx}`; `src/lib/payments/{confirmation-state.ts,balance-confirmation-state.ts}`;
  `src/server/actions/bookings.ts` (select) + `src/app/dashboard/bookings/page.tsx`;
  `src/components/dashboard/{pending-transfers-section.tsx,verify-transfer-dialog.tsx}`;
  `src/lib/notifications/{types.ts,templates.ts,email-provider.ts}`.

## Prerrequisitos de infra (usuario)

1. Crear bucket R2 privado.
2. Configurar CORS del bucket: permitir `PUT` desde el dominio de la app + los orígenes de preview de Vercel.
3. Regla de lifecycle: borrar objetos bajo `proofs/` con antigüedad > 180 días.
4. Setear `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` en Vercel (y `.env.local`).
