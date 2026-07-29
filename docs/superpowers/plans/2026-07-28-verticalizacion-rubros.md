# Verticalización por rubro — Plan de implementación

> **Para agentes:** este documento tiene la hoja de ruta de los 5 tracks y el detalle
> paso a paso del Track 1. Los tracks 2–5 tienen diseño cerrado pero **no** pasos
> detallados; se escriben justo antes de ejecutarlos, porque cada uno depende de lo
> que dejó el anterior (el track 2 y el 5 tocan los dos el motor de slots).

**Objetivo:** que agendita deje de asumir "salón de uñas en Chile" y sirva a barberías,
masajes, terapias y rubros remotos (constelaciones, registros akáshicos) sin
duplicar producto.

**Arquitectura:** la variabilidad real es **por servicio**, no por rubro. El rubro
(`BusinessCategory`, ya existe) sólo elige *defaults* y *vocabulario*. Nada de
`if (category === 'barber')` en lógica de negocio — si un rubro necesita un
comportamiento, ese comportamiento se expresa como configuración de un motor común.

**Stack:** Next.js 16 App Router, Prisma/Postgres, vitest (unit + integration),
Playwright (e2e), Tailwind + shadcn.

---

## Contexto: qué ya existe

- `enum BusinessCategory { nails, barber, hair_salon, beauty, massage, therapy, other }`
  en `prisma/schema.prisma:36`.
- El registro ya pide "Rubro" (`src/app/register/page.tsx:130`).
- El rubro se usa para **una sola cosa**: sembrar servicios de ejemplo
  (`SERVICE_TEMPLATES`, `src/lib/auth/actions.ts:17`). Después no se lee nunca más.
- `getCurrentUserWithBusiness()` (`src/lib/auth/user.ts`) está envuelto en
  `React.cache` y devuelve el business completo — incluido `category`. Leer el rubro
  en cualquier server component del dashboard **no cuesta una query extra**.
- No hay ningún `createContext` en el proyecto. El track 1 introduce el primero.

## Decisiones cerradas

| Decisión | Resuelto |
|---|---|
| Vocabulario | Femenino en `nails`, `beauty`, `hair_salon`. Neutro en `barber`, `massage`, `therapy`, `other`. |
| Modalidad | Es un atributo **del servicio**, no del negocio. Un servicio puede tener varias. |
| Confirmación manual | Flag del negocio (`requireBookingApproval`), no del rubro. |
| Multi-profesional | **Pendiente** — depende de quién cobra (ver Track 5). |
| Rubros nuevos | No se agregan valores al enum en esta iniciativa. `other` ya cubre constelaciones/registros akáshicos: lo que ese caso necesita es *modalidad online*, no un rubro propio. |

## Orden y por qué

1. **Vocabulario** — el barbero real ve texto mal escrito hoy. Barato, cero riesgo.
2. **Confirmación manual** — un barbero sin abono tiene la agenda abierta a que se la llenen. Es el que más le duele.
3. **Modalidad** (local / domicilio / online) — desbloquea domicilio y rubros remotos.
4. **Fotos en la ficha** — alto valor en uñas y color, no urgente.
5. **Multi-profesional** — el más grande, y puede que no haga falta.

---

# Track 1 — Vocabulario por rubro

**Entrega:** un PR. Ningún cambio de comportamiento para los negocios existentes
(`nails`/`beauty`/`hair_salon` siguen leyendo exactamente lo mismo que hoy).

## El problema real

Hay ~60 strings de cara al usuario con género femenino hardcodeado, repartidos en
UI del dashboard, plantillas de email y mensajes de error de server actions.

En castellano el género **sólo** rompe en artículos, adjetivos y participios — los
verbos no concuerdan. Así que "Tus clientas verán estos datos" → "Tus clientes verán
estos datos" es un reemplazo de sustantivo y ya está correcto. Sólo un puñado de
frases necesita cuidado real:

- `Reactivar inactivas` → `inactivos` (adjetivo)
- `Referidas` → `Referidos` (adjetivo nominalizado)
- `una clienta` → `un cliente` (artículo)
- `La clienta` / `Esta clienta` → `El cliente` / `Este cliente`
- `ambas reciben` → `ambos reciben`

Por eso el léxico guarda **frases con concordancia ya resuelta**, no palabras sueltas
que después haya que pegar. Nada de trucos tipo `inactiv${v.o}s`: son ilegibles y se
rompen con el primer adjetivo irregular.

## Estructura de archivos

- Crear: `src/lib/vocabulary/index.ts` — léxicos + `getVocabulary(category)`. Puro, sin deps.
- Crear: `src/lib/vocabulary/server.ts` — `getBusinessVocabulary()` para server components/actions.
- Crear: `src/components/vocabulary-provider.tsx` — context + `useVocabulary()` para client components.
- Crear: `tests/unit/vocabulary.test.ts`
- Modificar: `src/app/dashboard/layout.tsx` — envolver el árbol en el provider.
- Modificar: los ~25 archivos con strings de género (listados por tarea abajo).

## Task 1.1 — El módulo de vocabulario

**Files:**
- Create: `src/lib/vocabulary/index.ts`
- Test: `tests/unit/vocabulary.test.ts`

- [ ] **Paso 1: escribir el test que falla**

```ts
import { describe, it, expect } from 'vitest'
import { getVocabulary, VOCABULARIES } from '@/lib/vocabulary'

describe('vocabulario por rubro', () => {
  it('los rubros con clientela femenina mantienen el texto actual', () => {
    for (const category of ['nails', 'beauty', 'hair_salon'] as const) {
      expect(getVocabulary(category).clients).toBe('clientas')
    }
  })

  it('los demás rubros usan la forma neutra', () => {
    for (const category of ['barber', 'massage', 'therapy', 'other'] as const) {
      expect(getVocabulary(category).clients).toBe('clientes')
    }
  })

  // Guarda contra el olvido más probable: agregar una clave a un léxico y no al otro.
  it('todos los léxicos tienen exactamente las mismas claves', () => {
    const [first, ...rest] = Object.values(VOCABULARIES)
    for (const lexicon of rest) {
      expect(Object.keys(lexicon).sort()).toEqual(Object.keys(first).sort())
    }
  })

  it('ninguna entrada queda vacía', () => {
    for (const lexicon of Object.values(VOCABULARIES)) {
      for (const [key, value] of Object.entries(lexicon)) {
        expect(value, key).not.toBe('')
      }
    }
  })
})
```

- [ ] **Paso 2: correrlo y verificar que falla**

```bash
npx vitest run tests/unit/vocabulary.test.ts
```

Esperado: FAIL — `Cannot find module '@/lib/vocabulary'`.

- [ ] **Paso 3: implementar el módulo**

```ts
import type { BusinessCategory } from '@prisma/client'

/**
 * Vocabulario de cara al usuario que cambia según el rubro del negocio.
 *
 * POR QUÉ FRASES Y NO PALABRAS: en castellano el género arrastra artículos,
 * adjetivos y participios. Guardar sólo el sustantivo y pegarlo en el call site
 * produce "el clienta" y "clientes inactivas". Cada entrada acá ya viene con la
 * concordancia resuelta, escrita a mano, en las dos formas.
 *
 * POR QUÉ NO ES UN i18n COMPLETO: la enorme mayoría de las frases del producto
 * sólo tienen un sustantivo genérico y ninguna otra marca de género — ahí alcanza
 * con interpolar `clients`. Sólo las que arrastran concordancia viven enteras acá.
 */
export interface Vocabulary {
  /** "clienta" | "cliente" */
  client: string
  /** "clientas" | "clientes" */
  clients: string
  /** "Clienta" | "Cliente" — encabezado de tabla y etiqueta de email */
  Client: string
  /** "la clienta" | "el cliente" */
  theClient: string
  /** "La clienta" | "El cliente" — arranque de oración */
  TheClient: string
  /** "una clienta" | "un cliente" */
  aClient: string
  /** "Esta clienta" | "Este cliente" */
  thisClient: string
  /** "clientas inactivas" | "clientes inactivos" */
  inactiveClients: string
  /** "Reactivar inactivas" | "Reactivar inactivos" — label de la regla automática */
  reactivateInactiveLabel: string
  /** "Referidas" | "Referidos" — label de la regla automática */
  referralsLabel: string
  /** Preset de referidos: arrastra concordancia en dos puntos ("una clienta" + "ambas"). */
  referralPresetLine: string
}

const FEMININE: Vocabulary = {
  client: 'clienta',
  clients: 'clientas',
  Client: 'Clienta',
  theClient: 'la clienta',
  TheClient: 'La clienta',
  aClient: 'una clienta',
  thisClient: 'Esta clienta',
  inactiveClients: 'clientas inactivas',
  reactivateInactiveLabel: 'Reactivar inactivas',
  referralsLabel: 'Referidas',
  referralPresetLine: 'Cuando una clienta refiere a alguien nuevo, ambas reciben 20% de descuento.',
}

const NEUTRAL: Vocabulary = {
  client: 'cliente',
  clients: 'clientes',
  Client: 'Cliente',
  theClient: 'el cliente',
  TheClient: 'El cliente',
  aClient: 'un cliente',
  thisClient: 'Este cliente',
  inactiveClients: 'clientes inactivos',
  reactivateInactiveLabel: 'Reactivar inactivos',
  referralsLabel: 'Referidos',
  referralPresetLine: 'Cuando un cliente refiere a alguien nuevo, ambos reciben 20% de descuento.',
}

export const VOCABULARIES = { feminine: FEMININE, neutral: NEUTRAL } as const

/**
 * Femenino en los rubros donde ya era el texto vigente — cambiarlo les movería el
 * tono a las manicuristas que ya usan el producto. Neutro en todo lo demás.
 */
const BY_CATEGORY: Record<BusinessCategory, Vocabulary> = {
  nails: FEMININE,
  beauty: FEMININE,
  hair_salon: FEMININE,
  barber: NEUTRAL,
  massage: NEUTRAL,
  therapy: NEUTRAL,
  other: NEUTRAL,
}

export function getVocabulary(category: BusinessCategory): Vocabulary {
  return BY_CATEGORY[category] ?? NEUTRAL
}
```

- [ ] **Paso 4: correr el test y verificar que pasa**

```bash
npx vitest run tests/unit/vocabulary.test.ts
```

Esperado: PASS, 4 tests.

- [ ] **Paso 5: commit**

```bash
git add src/lib/vocabulary/index.ts tests/unit/vocabulary.test.ts
git commit -m "feat(vocabulario): léxico por rubro con concordancia resuelta"
```

## Task 1.2 — Acceso desde server y desde cliente

**Files:**
- Create: `src/lib/vocabulary/server.ts`
- Create: `src/components/vocabulary-provider.tsx`
- Modify: `src/app/dashboard/layout.tsx`

- [ ] **Paso 1: helper de servidor**

```ts
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { getVocabulary, type Vocabulary } from './index'

/**
 * Vocabulario del negocio en sesión, para server components y server actions.
 *
 * No agrega ninguna query: getCurrentUserWithBusiness está envuelto en React.cache
 * y el layout del dashboard ya la llamó en el mismo request.
 *
 * Devuelve el léxico neutro si no hay negocio (superficies públicas, /recover-business).
 */
export async function getBusinessVocabulary(): Promise<Vocabulary> {
  const userData = await getCurrentUserWithBusiness()
  return getVocabulary(userData?.business?.category ?? 'other')
}
```

- [ ] **Paso 2: provider para client components**

```tsx
'use client'

import { createContext, useContext } from 'react'
import { getVocabulary, type Vocabulary } from '@/lib/vocabulary'

// El default es el neutro y no null: así un componente cliente montado fuera del
// dashboard (Storybook, un test de render suelto) no revienta — muestra la forma
// neutra, que es la que menos molesta si se escapa.
const VocabularyContext = createContext<Vocabulary>(getVocabulary('other'))

export function VocabularyProvider({ value, children }: { value: Vocabulary; children: React.ReactNode }) {
  return <VocabularyContext.Provider value={value}>{children}</VocabularyContext.Provider>
}

export function useVocabulary(): Vocabulary {
  return useContext(VocabularyContext)
}
```

- [ ] **Paso 3: envolver el dashboard**

En `src/app/dashboard/layout.tsx`, importar `getVocabulary` y `VocabularyProvider`,
y envolver el `<div className="flex min-h-screen ...">` existente:

```tsx
<VocabularyProvider value={getVocabulary(userData.business.category)}>
  <div className="flex min-h-screen bg-background text-foreground">
    {/* ...contenido actual sin cambios... */}
  </div>
</VocabularyProvider>
```

- [ ] **Paso 4: verificar que compila**

```bash
npx tsc --noEmit 2>&1 | grep '^src/' || echo "sin errores de tipos"
```

- [ ] **Paso 5: commit**

```bash
git add src/lib/vocabulary/server.ts src/components/vocabulary-provider.tsx src/app/dashboard/layout.tsx
git commit -m "feat(vocabulario): acceso desde server components y provider de cliente"
```

## Tasks 1.3 – 1.6 — Reemplazar los call sites

Un commit por área. En cada archivo: si es client component, `useVocabulary()`; si es
server component, `await getBusinessVocabulary()`.

- [ ] **1.3 — Fidelización y promociones** (13 strings)
  - `src/app/dashboard/fidelizacion/automatic-rules.tsx` (6, incluye `reactivateInactiveLabel` y `referralsLabel`)
  - `src/app/dashboard/fidelizacion/redemption-catalog.tsx` (2)
  - `src/app/dashboard/fidelizacion/loyalty-config-form.tsx` (1)
  - `src/app/dashboard/fidelizacion/page.tsx` (1)
  - `src/app/dashboard/promociones/redemptions-button.tsx` (2 — uno es encabezado de CSV)
  - `src/lib/loyalty/presets.ts` (2 — usa `referralPresetLine`)

- [ ] **1.4 — Campañas** (7 strings)
  - `src/app/dashboard/campanas/page.tsx` (2)
  - `src/app/dashboard/campanas/campaign-list.tsx` (1)
  - `src/app/dashboard/campanas/[id]/recipient-list.tsx` (2)
  - `src/app/dashboard/campanas/[id]/bulk-send-controls.tsx` (1)
  - `src/lib/campaigns/send.ts` (1 — mensaje de `UserError`)

- [ ] **1.5 — Pagos y transferencias** (10 strings)
  - `src/app/dashboard/settings/payments/bank-transfer-form.tsx` (4)
  - `src/app/dashboard/settings/payments/page.tsx` (2)
  - `src/components/dashboard/verify-transfer-dialog.tsx` (1)
  - `src/components/dashboard/pending-transfers-section.tsx` (1)
  - `src/lib/cron/transfer-reminders.ts` (2 — fallback `'la clienta'`; el cron **no** tiene sesión, así que resuelve el léxico desde `business.category` del registro que ya trae)

- [ ] **1.6 — Resto del dashboard y mensajes de error** (12 strings)
  - `src/components/dashboard/settings-form.tsx` (2)
  - `src/components/dashboard/service-fit-warnings.tsx` (1)
  - `src/components/dashboard/revive-booking-dialog.tsx` (1 — `thisClient`)
  - `src/app/dashboard/bookings/[id]/reschedule/reschedule-form.tsx` (1)
  - `src/app/dashboard/paquetes/package-catalog.tsx` (1)
  - `src/app/dashboard/reviews/review-link-button.tsx` (1)
  - `src/server/actions/loyalty.ts` (3 — `'Clienta no encontrada'`)
  - `src/server/actions/packages.ts` (1)
  - `src/server/actions/campaigns.ts` (1)
  - `src/server/actions/reviews.ts` (1)
  - `src/lib/customers/link.ts` (1)

**Fuera de alcance a propósito:** `src/server/actions/my-bookings.ts:52`
(`reason: 'cancelada por la clienta desde /mi'`) es una nota interna del ledger, no
la ve nadie. Se deja como está.

## Task 1.7 — Plantillas de email

**Files:**
- Modify: `src/lib/notifications/templates.ts` (8 usos de `Clienta` como etiqueta de fila)
- Modify: `src/lib/notifications/types.ts`
- Modify: `src/lib/notifications/email-provider.ts` (1), `src/app/api/webhooks/mercado-pago/route.ts` (1 fallback)

Los emails **no tienen sesión** — se mandan desde crons y webhooks. Así que el léxico
no puede salir de `getBusinessVocabulary()`: hay que pasar `clientLabel: string` dentro
del objeto `data` de cada plantilla, resuelto por el caller desde el `category` del
negocio que ya carga.

- [ ] Agregar `clientLabel: string` a los tipos de email que hoy escriben `Clienta`.
- [ ] Reemplazar los literales por `${data.clientLabel}`.
- [ ] Actualizar los callers para que lo pasen.
- [ ] Ajustar los tests que asertan el texto (`src/lib/notifications/packages.test.ts`, `src/server/actions/packages-checkout.create.test.ts`).

## Task 1.8 — Verificación y PR

- [ ] **Paso 1: no quedan literales sueltos**

```bash
grep -rn "clienta\|Clienta" src/ --include="*.tsx" --include="*.ts" | grep -vE ":[0-9]+:\s*(//|\*|/\*)" | grep -v "src/lib/vocabulary/"
```

Esperado: sólo el ledger interno de `my-bookings.ts` y comentarios.

- [ ] **Paso 2: suite completa**

```bash
npx vitest run
```

- [ ] **Paso 3: tipos** — CI corre `build` y vitest/eslint **no** chequean tipos.

```bash
npx tsc --noEmit 2>&1 | grep '^src/' || echo "sin errores de tipos"
```

- [ ] **Paso 4: PR** con título `feat(vocabulario): el texto del dashboard se adapta al rubro`.

---

# Track 2 — Confirmación manual del negocio

**Diseño cerrado, pasos pendientes.**

Hoy los estados son `pending_payment → confirmed`. Un negocio sin abono recibe reservas
auto-confirmadas: cualquiera le llena la agenda.

- `Business.requireBookingApproval Boolean @default(false)` — flag, no rubro.
- `BookingStatus.pending_confirmation` nuevo.
- **Landmine:** el estado nuevo tiene que bloquear el slot igual que `confirmed`, o se
  duplican reservas. Hay que sumarlo a toda enumeración de estados que ocupan agenda
  (`generateSlots`, `getEffectiveBlocks`, los índices de `Booking`, `payable-statuses.ts`).
- Aceptar → `confirmed` + email. Rechazar → `cancelled` + `rejectionReason` +
  `suggestedStartDateTime DateTime?` opcional, que el email muestra con link para
  re-reservar.
- Interactúa con holds y con el cron de expiración: una reserva esperando confirmación
  necesita su propio vencimiento, o queda colgada para siempre.

# Track 3 — Modalidad de atención

**Diseño cerrado, pasos pendientes.**

- `enum ServiceModality { on_site, at_home, online }`.
- `Service.modalities ServiceModality[] @default([on_site])` — varias por servicio; el
  wizard sólo pregunta cuando hay más de una.
- `Booking.modality` + `Booking.serviceAddress String?` (domicilio) + `Booking.meetingUrl String?` (online).
- Desbloquea constelaciones y registros akáshicos sin agregar rubros al enum.
- **Fuera de alcance:** tiempo de traslado entre domicilios. Es un problema real de
  agenda y merece su propia iniciativa — no lo metas de contrabando acá.

# Track 4 — Fotos en la ficha

**Diseño cerrado, pasos pendientes.**

- `CustomerPhoto` — `businessId`, `customerId`, `bookingId?`, `key`, `caption?`, `createdAt`.
- Reusa el presign de `src/lib/storage/r2.ts` con un namespace nuevo
  (`src/lib/storage/photos.ts`, espejo de `proof.ts`). Sólo imágenes, sin PDF.
- Se ve en el detalle de la ficha y al abrir una reserva.

# Track 5 — Multi-profesional

**Bloqueado por una pregunta de producto, no por código.**

La pregunta: **¿quién cobra?**

- Si cada barbero cobra lo suyo → cada uno se hace su propia cuenta. **Ya funciona hoy,
  el track no existe.**
- Si el dueño cobra y le paga a los barberos → una cuenta, varios profesionales adentro,
  porque la plata, las fichas y el calendario son del negocio.

Si resulta que hace falta, el diseño arranca por `StaffMember` **sin cuenta propia**
(nombre, foto, bio, horario) y `Booking.staffId`. El login por profesional se cuelga
después sin romper nada.
