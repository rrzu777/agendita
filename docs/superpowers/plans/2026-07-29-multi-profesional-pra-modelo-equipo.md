# PR A — Modelo `Professional` y pantalla de equipo

> **Para quien lo ejecute:** los pasos van con checkbox (`- [ ]`). El diseño completo del
> track está en `docs/superpowers/specs/2026-07-29-multi-profesional-design.md`; este plan
> cubre **sólo el PR A** de los seis.

**Goal:** que un negocio pueda dar de alta a su equipo, decir qué servicios hace cada
persona y en qué modalidades trabaja — **sin que cambie nada** de cómo se reserva hoy.

**Architecture:** todo lo nuevo es aditivo y nullable. El modelo `Professional` y las
cuatro columnas `professionalId` entran en esta migración pero **nadie las lee todavía**:
la disponibilidad (PR B), la validación al reservar (PR C) y el funnel (PR D) van después.
Este PR entrega el modelo, el CRUD y la pantalla; el comportamiento de la app queda
byte por byte igual porque ninguna query existente aprende a filtrar por persona.

**Tech Stack:** Next.js 16 (App Router, server actions), Prisma + Postgres, Zod, Vitest,
Tailwind + los componentes de `src/components/ui`.

---

## Por qué este PR es de riesgo nulo, y qué lo haría dejar de serlo

El spec dice "nadie ve nada distinto". Se sostiene por una razón concreta: **agregar una
columna nullable que ninguna query menciona no cambia ningún resultado.** Las 22 queries
de horario y bloqueos siguen preguntando por `businessId` a secas, así que siguen
devolviendo exactamente las mismas filas.

Lo único que un negocio ve de nuevo es un ítem en el menú y una pantalla. Si alguien da
de alta a 4 personas con este PR mergeado y el B todavía no, **la agenda sigue siendo la
del negocio** — los datos quedan guardados esperando al PR B. Eso es correcto y es la
razón por la que se puede mergear solo.

**Lo que lo rompería:** que este PR le enseñe a alguna query existente a filtrar por
persona. No lo hace, y no debe. Si aparece la tentación, va al PR B.

---

## Decisiones de diseño que este plan cierra

Tres cosas que el spec dejaba a criterio del PR:

### 1. `onDelete` de cada relación, y por qué `Restrict` en `Booking`

El spec pide "bajas, no borrados" y explica el peligro: un `SetNull` en las reservas las
convierte en reservas sin persona, y por la semántica `null = choca contra todos`, **un
salón de 4 se queda sin agenda**. La forma más profunda de garantizarlo no es un `if` en
la action: es que la base se niegue.

| Relación | `onDelete` | Por qué |
|---|---|---|
| `Booking.professional` | **`Restrict`** | La base rechaza borrar a alguien con reservas. El chequeo en la action es cortesía de UX; el guard real es éste. |
| `AvailabilityRule.professional` | `Cascade` | El horario de una persona no significa nada sin la persona. |
| `TimeBlock.professional` | `Cascade` | Idem: sus vacaciones se van con ella. |
| `TimeBlockSeries.professional` | `Cascade` | Idem. |
| `Business.professionals` | `Cascade` | Igual que todo lo demás que cuelga del negocio. |

Ojo con el cascade: **sólo afecta a las filas que tienen `professionalId`**. Las filas con
`null` (todas las de hoy) no tienen FK que cascadear, así que borrar a una persona
**nunca** toca el horario del negocio. Esa es la propiedad que hace que la semántica de
`null` sea segura.

`Restrict` implica que una reserva **pasada** también frena el borrado, no sólo una
futura. Es a propósito: la ficha de la clienta va a mostrar "quién te atendió" (PR E) y
esa historia no se tira. Para sacar a alguien del equipo está la baja.

### 2. Borrado duro sólo si nunca atendió

`deleteProfessional` borra de verdad **si y sólo si** la persona tiene 0 reservas — el
caso de "la cargué mal, la quiero sacar". Con una reserva o más, devuelve un `UserError`
que dice qué hacer (desactivar) en vez de un error de base de datos crudo.

Es más chico que "reservas futuras" del spec y es a propósito: coincide exactamente con
lo que el `Restrict` permite, así que la action nunca promete algo que la base va a
rechazar. Un solo criterio en los dos niveles.

### 3. Las modalidades de una persona se derivan de sus servicios

El spec advierte el agujero: si alguien queda en `on_site` a secas, **un servicio
online-only se queda sin nadie que lo dé y el negocio no se entera.** Así que
`deriveModalities(services)` — la unión de las modalidades de los servicios asignados —
es una función pura, se testea sola, y se usa en **dos** lugares:

- el formulario, para pre-marcar los checkboxes al elegir servicios;
- el servidor, cuando el payload no trae modalidades.

No se impone: la dueña puede destildar "a domicilio" para quien no viaja. Eso es
justamente el dato que el PR D necesita para no ofrecer "corte a domicilio con Juan".

---

## Estructura de archivos

**Crear:**

| Archivo | Responsabilidad |
|---|---|
| `prisma/migrations/20260730120000_add_professionals/migration.sql` | El DDL, escrito a mano |
| `src/lib/professionals/schema.ts` | Los schemas de Zod del CRUD |
| `src/lib/professionals/modalities.ts` | `deriveModalities` — pura, la unión |
| `src/server/actions/professionals.ts` | El CRUD (`'use server'`) |
| `src/app/dashboard/equipo/page.tsx` | La página (server component) |
| `src/components/dashboard/professional-table.tsx` | La tabla + el explicador del interruptor |
| `src/components/dashboard/professional-form.tsx` | El diálogo de alta/edición |
| `src/components/dashboard/professional-row-actions.tsx` | Editar / activar / borrar por fila |
| `tests/unit/professionals-schema.test.ts` | El schema y `deriveModalities` |
| `tests/unit/professional-table.test.tsx` | La pantalla, incluido el explicador |
| `tests/integration/professionals.test.ts` | La migración de verdad + el CRUD (sólo CI) |

**Modificar:**

| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` | `Professional`, `professionalId` en 4 modelos, back-relations |
| `src/components/dashboard/sidebar.tsx:30-45` | El ítem de menú, con label del léxico |
| `src/server/actions/services.ts:40-47` | Pre-asignar el servicio nuevo al equipo activo |

**Explícitamente NO se toca** (y si el diff los toca, el PR está mal): `slots.ts`,
`effective-blocks.ts`, `validation.ts`, `scope.ts` (no existe todavía), `time-blocks.ts`,
`availability.ts`, `bookings.ts`, `draft.ts`, `public.ts`, el wizard, los emails.

---

## Task 1: el schema de Prisma y la migración

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260730120000_add_professionals/migration.sql`

**Contexto que no se puede adivinar:** no hay Postgres local ni Docker corriendo, y el
`.env.local` del checkout principal apunta a **Supabase de producción**. Así que:

- **NO** corras `prisma migrate dev` ni `prisma migrate diff`. La primera escribe en la
  base a la que apunte el env; la segunda, además, levanta cambios de ramas hermanas y
  emite `DROP`s ajenos (ya mordió antes).
- La migración se escribe **a mano**. Se aplica sola en CI y en el deploy de Vercel, que
  corren `migrate deploy`.

- [ ] **Step 1: agregar el modelo `Professional` al schema**

En `prisma/schema.prisma`, justo después del modelo `Service` (que termina en la línea
con `@@index([businessId, isActive])`, hoy `:298`):

```prisma
/// Quién atiende. Sin cuenta propia: no hay login por profesional, y el enum
/// `BusinessRole.staff` (hoy muerto, cero usos) es un rol de login, otra cosa.
/// Colgarle un `userId` nullable más adelante no rompe nada de esto.
///
/// La PRESENCIA de filas activas es el interruptor del multi-profesional: cero
/// activos = el negocio se comporta exactamente como antes de que este modelo
/// existiera. Ver el spec del track 5.
model Professional {
  id         String   @id @default(cuid())
  businessId String
  name       String
  bio        String?
  isActive   Boolean  @default(true)
  sortOrder  Int      @default(0)
  /// Dónde atiende ESTA persona. Se intersecta con las del servicio: un servicio
  /// a domicilio + alguien que no viaja = combinación que el funnel no ofrece
  /// (eso lo consume el PR D). El default del schema es sólo un piso; al crear
  /// a alguien desde el panel se pre-marca la UNIÓN de las modalidades de sus
  /// servicios, porque dejarlo en on_site a secas deja un servicio online-only
  /// sin nadie que lo pueda dar y el negocio no se entera.
  modalities ServiceModality[] @default([on_site])
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  business Business           @relation(fields: [businessId], references: [id], onDelete: Cascade)
  services Service[]          @relation("ProfessionalServices")
  rules    AvailabilityRule[]
  blocks   TimeBlock[]
  series   TimeBlockSeries[]
  bookings Booking[]

  @@index([businessId, isActive])
}
```

- [ ] **Step 2: las cuatro columnas nullable y las back-relations**

En `model Business`, junto a las otras listas (después de `customerPhotos`):

```prisma
  professionals        Professional[]
```

En `model Service`, junto a `promotions` / `packageProducts`:

```prisma
  professionals   Professional[]   @relation("ProfessionalServices")
```

En `model AvailabilityRule` — la regla queda así completa:

```prisma
model AvailabilityRule {
  id         String  @id @default(cuid())
  businessId String
  /// null = el horario DEL NEGOCIO (todas las filas que existen hoy).
  /// Con persona = el horario de esa persona. Ningún lector filtra por esto
  /// todavía; lo hace el PR B.
  professionalId String?
  dayOfWeek  Int
  startTime  String
  endTime    String
  isActive   Boolean @default(true)

  business     Business      @relation(fields: [businessId], references: [id], onDelete: Cascade)
  professional Professional? @relation(fields: [professionalId], references: [id], onDelete: Cascade)

  @@index([businessId])
  @@index([professionalId])
}
```

En `model TimeBlock`, después de `businessId`:

```prisma
  /// null = cierra para TODOS (el feriado del salón). Con persona = sólo esa
  /// persona (sus vacaciones).
  professionalId          String?
```
y en el bloque de relaciones:
```prisma
  professional Professional? @relation(fields: [professionalId], references: [id], onDelete: Cascade)
```
y un índice más: `@@index([professionalId])`

En `model TimeBlockSeries`, idéntico: el campo con el mismo comentario, la relación
`onDelete: Cascade` y `@@index([professionalId])`.

En `model Booking`, después de `customerId`:

```prisma
  /// null = reserva sin persona: por conservadora, CHOCA CONTRA TODOS. Son las
  /// reservas hechas antes de que el negocio tuviera equipo, y nunca queremos
  /// meterle a alguien una cita encima. El solape lo implementa el PR C.
  professionalId String?
```
y en el bloque de relaciones — ojo el `Restrict`, no es un descuido:
```prisma
  professional Professional? @relation(fields: [professionalId], references: [id], onDelete: Restrict)
```
y `@@index([professionalId])` junto a los otros índices.

**No se agrega ningún `@@unique`.** `AvailabilityRule` nunca tuvo unique sobre
`(businessId, dayOfWeek)`, sólo índice; sumarle `professionalId` no serviría igual porque
Postgres trata los NULL como distintos, y podría chocar con datos ya duplicados.

- [ ] **Step 3: escribir la migración a mano**

`prisma/migrations/20260730120000_add_professionals/migration.sql`:

```sql
-- Multi-profesional (Track 5). Todo aditivo y nullable: ninguna fila existente
-- se reescribe, y `professionalId IS NULL` significa exactamente lo que hay hoy.
--
-- El nombre de la tabla de join (`_ProfessionalServices`, columnas A/B) y sus
-- índices son la forma que Prisma le da a un muchos-a-muchos implícito. Mismo
-- molde que `_PromotionServices` y `_PackageProductServices`.

-- CreateTable
CREATE TABLE "Professional" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bio" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "modalities" "ServiceModality"[] DEFAULT ARRAY['on_site']::"ServiceModality"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Professional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ProfessionalServices" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- AlterTable: las cuatro columnas nullable. Sin backfill: NULL ya es el valor
-- correcto para todo lo que existe.
ALTER TABLE "AvailabilityRule" ADD COLUMN "professionalId" TEXT;
ALTER TABLE "TimeBlock" ADD COLUMN "professionalId" TEXT;
ALTER TABLE "TimeBlockSeries" ADD COLUMN "professionalId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "professionalId" TEXT;

-- CreateIndex
CREATE INDEX "Professional_businessId_isActive_idx" ON "Professional"("businessId", "isActive");
CREATE UNIQUE INDEX "_ProfessionalServices_AB_unique" ON "_ProfessionalServices"("A", "B");
CREATE INDEX "_ProfessionalServices_B_index" ON "_ProfessionalServices"("B");
CREATE INDEX "AvailabilityRule_professionalId_idx" ON "AvailabilityRule"("professionalId");
CREATE INDEX "TimeBlock_professionalId_idx" ON "TimeBlock"("professionalId");
CREATE INDEX "TimeBlockSeries_professionalId_idx" ON "TimeBlockSeries"("professionalId");
CREATE INDEX "Booking_professionalId_idx" ON "Booking"("professionalId");

-- AddForeignKey
ALTER TABLE "Professional" ADD CONSTRAINT "Professional_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_ProfessionalServices" ADD CONSTRAINT "_ProfessionalServices_A_fkey" FOREIGN KEY ("A") REFERENCES "Professional"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_ProfessionalServices" ADD CONSTRAINT "_ProfessionalServices_B_fkey" FOREIGN KEY ("B") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- El horario y los bloqueos de una persona no significan nada sin ella: CASCADE.
-- Ojo que el cascade sólo alcanza a las filas que tienen professionalId; las de
-- hoy están en NULL y no las toca, así que borrar a alguien NUNCA se lleva el
-- horario del negocio.
ALTER TABLE "AvailabilityRule" ADD CONSTRAINT "AvailabilityRule_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "Professional"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeBlock" ADD CONSTRAINT "TimeBlock_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "Professional"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeBlockSeries" ADD CONSTRAINT "TimeBlockSeries_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "Professional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Las reservas NO: RESTRICT. Un SET NULL acá las convertiría en reservas sin
-- persona, que por la semántica elegida chocan contra TODO EL EQUIPO — un salón
-- de 4 se queda sin agenda y nadie entiende por qué. Que la base se niegue es
-- el guard de verdad; el mensaje lindo lo pone la action.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "Professional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 4: validar el schema sin tocar ninguna base**

```bash
npx prisma validate
```
Esperado: `The schema at prisma/schema.prisma is valid 🚀`. Este comando **no** se conecta
a la base; es seguro.

- [ ] **Step 5: regenerar el cliente — avisando primero**

El cliente generado es **uno solo para todas las worktrees**. Regenerar desde este schema
le mete `Professional` y `professionalId` al `tsc` de las otras sesiones. Ya se mandó el
aviso; si alguien pidió esperar, esperar.

```bash
npx prisma generate
```

Al terminar el PR (después del merge), restaurarlo desde el schema de `main`:
```bash
git -C /Users/robertozamorautrera/Projects/agendita checkout main -- prisma/schema.prisma && npx prisma generate
```

- [ ] **Step 6: commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260730120000_add_professionals
git commit -m "feat(equipo): modelo Professional y professionalId nullable en cuatro tablas"
```

---

## Task 2: `deriveModalities` — la unión, y por qué es una función

**Files:**
- Create: `src/lib/professionals/modalities.ts`
- Test: `tests/unit/professionals-schema.test.ts`

- [ ] **Step 1: escribir el test que falla**

```ts
import { describe, it, expect } from 'vitest'
import { ServiceModality } from '@prisma/client'
import { deriveModalities } from '@/lib/professionals/modalities'

describe('deriveModalities', () => {
  it('sin servicios cae en el local, que es el default del schema', () => {
    expect(deriveModalities([])).toEqual([ServiceModality.on_site])
  })

  it('une las modalidades de todos los servicios, sin repetir', () => {
    const result = deriveModalities([
      { modalities: [ServiceModality.on_site, ServiceModality.at_home] },
      { modalities: [ServiceModality.at_home] },
      { modalities: [ServiceModality.online] },
    ])
    expect(result).toEqual([
      ServiceModality.on_site,
      ServiceModality.at_home,
      ServiceModality.online,
    ])
  })

  // Es el agujero que el spec marcó: si alguien queda en on_site a secas, un
  // servicio online-only se queda sin nadie que lo dé y el negocio no se entera.
  it('un servicio online-only da una persona que atiende online y NADA más', () => {
    expect(deriveModalities([{ modalities: [ServiceModality.online] }])).toEqual([
      ServiceModality.online,
    ])
  })

  it('devuelve el orden canónico, no el de llegada', () => {
    const result = deriveModalities([
      { modalities: [ServiceModality.online] },
      { modalities: [ServiceModality.on_site] },
    ])
    expect(result).toEqual([ServiceModality.on_site, ServiceModality.online])
  })
})
```

- [ ] **Step 2: correr el test y verificar que falla**

```bash
npx vitest run tests/unit/professionals-schema.test.ts
```
Esperado: FAIL — no existe `@/lib/professionals/modalities`.

- [ ] **Step 3: implementar**

```ts
import { ServiceModality } from '@prisma/client'
import { sortModalities } from '@/lib/services/modality'

/**
 * Las modalidades que le corresponden a alguien por los servicios que hace: la
 * UNIÓN, no la intersección.
 *
 * Por qué la unión: si hace un servicio a domicilio y otro en el local, trabaja
 * en las dos. La intersección la dejaría sin ninguna. El recorte por persona
 * ("Juan no viaja") es una decisión de la dueña, que destilda a mano; esto es
 * sólo el punto de partida.
 *
 * Se usa en DOS lugares — el formulario, para pre-marcar los checkboxes, y el
 * servidor, cuando el payload no trae modalidades — y por eso vive acá y no
 * adentro de un componente.
 *
 * Sin servicios devuelve `[on_site]`, el mismo default que el schema: una lista
 * vacía dejaría a la persona sin poder atender nada.
 */
export function deriveModalities(
  services: { modalities: ServiceModality[] }[],
): ServiceModality[] {
  const union = new Set(services.flatMap((s) => s.modalities))
  if (union.size === 0) return [ServiceModality.on_site]
  return sortModalities([...union])
}
```

- [ ] **Step 4: correr el test y verificar que pasa**

```bash
npx vitest run tests/unit/professionals-schema.test.ts
```
Esperado: PASS, 4 casos.

- [ ] **Step 5: commit**

```bash
git add src/lib/professionals/modalities.ts tests/unit/professionals-schema.test.ts
git commit -m "feat(equipo): las modalidades de una persona salen de la union de sus servicios"
```

---

## Task 3: los schemas de Zod

**Files:**
- Create: `src/lib/professionals/schema.ts`
- Test: `tests/unit/professionals-schema.test.ts` (se agrega al de la Task 2)

- [ ] **Step 1: agregar los tests que fallan**

Al final de `tests/unit/professionals-schema.test.ts`:

```ts
import {
  createProfessionalSchema,
  updateProfessionalSchema,
} from '@/lib/professionals/schema'

describe('createProfessionalSchema', () => {
  const valid = { name: 'Juan', serviceIds: ['svc-1'] }

  it('acepta lo mínimo: un nombre', () => {
    const parsed = createProfessionalSchema.safeParse({ name: 'Juan' })
    expect(parsed.success).toBe(true)
  })

  it('rechaza un nombre vacío o de sólo espacios', () => {
    expect(createProfessionalSchema.safeParse({ name: '   ' }).success).toBe(false)
  })

  it('recorta el nombre', () => {
    const parsed = createProfessionalSchema.parse({ name: '  Juan  ' })
    expect(parsed.name).toBe('Juan')
  })

  it('rechaza un nombre de más de 100 caracteres', () => {
    expect(createProfessionalSchema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false)
  })

  it('rechaza una bio de más de 500 caracteres', () => {
    expect(
      createProfessionalSchema.safeParse({ ...valid, bio: 'x'.repeat(501) }).success,
    ).toBe(false)
  })

  // Mismo motivo que en los servicios: dos clicks rápidos no deben persistir
  // ['at_home','at_home'] y hacer que el picker muestre la opción repetida.
  it('deduplica las modalidades', () => {
    const parsed = createProfessionalSchema.parse({
      ...valid,
      modalities: ['at_home', 'at_home', 'on_site'],
    })
    expect(parsed.modalities).toEqual(['at_home', 'on_site'])
  })

  it('rechaza una lista de modalidades vacía', () => {
    expect(
      createProfessionalSchema.safeParse({ ...valid, modalities: [] }).success,
    ).toBe(false)
  })

  // Sin modalidades el servidor las deriva de los servicios (deriveModalities),
  // así que la ausencia es válida y NO tiene default acá: un default a on_site
  // se comería la derivación.
  it('deja modalities indefinido cuando no viene', () => {
    const parsed = createProfessionalSchema.parse({ name: 'Juan' })
    expect(parsed.modalities).toBeUndefined()
  })

  it('deduplica los serviceIds', () => {
    const parsed = createProfessionalSchema.parse({
      name: 'Juan',
      serviceIds: ['svc-1', 'svc-1', 'svc-2'],
    })
    expect(parsed.serviceIds).toEqual(['svc-1', 'svc-2'])
  })

  it('descarta las claves que no están en el schema', () => {
    const parsed = createProfessionalSchema.parse({
      name: 'Juan',
      businessId: 'otro-negocio',
      isActive: false,
    })
    expect(parsed).not.toHaveProperty('businessId')
  })
})

describe('updateProfessionalSchema', () => {
  it('acepta un payload parcial', () => {
    expect(updateProfessionalSchema.safeParse({ bio: 'Corte clásico' }).success).toBe(true)
  })

  it('acepta un payload vacío (la action se encarga de rechazarlo)', () => {
    expect(updateProfessionalSchema.safeParse({}).success).toBe(true)
  })

  it('sigue validando el nombre cuando viene', () => {
    expect(updateProfessionalSchema.safeParse({ name: '' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: correr y verificar que falla**

```bash
npx vitest run tests/unit/professionals-schema.test.ts
```
Esperado: FAIL — no existe `@/lib/professionals/schema`.

- [ ] **Step 3: implementar**

`src/lib/professionals/schema.ts`:

```ts
import { z } from 'zod'
import { ServiceModality } from '@prisma/client'

// Al menos una: alguien sin modalidades no puede atender nada y el funnel
// tendría que inventarle un default. El dedup es el mismo que en los servicios:
// el formulario manda checkboxes y dos clicks rápidos podrían persistir
// ['at_home','at_home'].
const modalitiesSchema = z
  .array(z.nativeEnum(ServiceModality))
  .min(1, 'Elegí al menos una modalidad')
  .transform((values) => [...new Set(values)])

// Sin default a propósito: cuando no vienen, el servidor las deriva de los
// servicios asignados (deriveModalities). Un `.default([on_site])` acá se
// comería esa derivación y dejaría un servicio online-only sin nadie.
const serviceIdsSchema = z
  .array(z.string().min(1))
  .transform((values) => [...new Set(values)])

const nameSchema = z
  .string()
  .trim()
  .min(1, 'El nombre es requerido')
  .max(100, 'El nombre es demasiado largo')

const bioSchema = z
  .string()
  .trim()
  .max(500, 'La descripción es demasiado larga')
  .optional()
  .nullable()

export const createProfessionalSchema = z.object({
  name: nameSchema,
  bio: bioSchema,
  modalities: modalitiesSchema.optional(),
  serviceIds: serviceIdsSchema.optional(),
}).strip()

export const updateProfessionalSchema = z.object({
  name: nameSchema.optional(),
  bio: bioSchema,
  modalities: modalitiesSchema.optional(),
  serviceIds: serviceIdsSchema.optional(),
}).strip()

export const reorderProfessionalsSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    sortOrder: z.number().int().nonnegative(),
  })),
}).strip()
```

- [ ] **Step 4: correr y verificar que pasa**

```bash
npx vitest run tests/unit/professionals-schema.test.ts
```
Esperado: PASS, 17 casos (4 de la Task 2 + 13).

- [ ] **Step 5: commit**

```bash
git add src/lib/professionals/schema.ts tests/unit/professionals-schema.test.ts
git commit -m "feat(equipo): schemas de validacion del CRUD de equipo"
```

---

## Task 4: las server actions

**Files:**
- Create: `src/server/actions/professionals.ts`
- Modify: `src/server/actions/services.ts:40-47`

**Dos guards de CI mandan acá** (`tests/unit/use-server-exports.test.ts` y
`tests/unit/server-actions-auth.test.ts`): en un módulo `'use server'` **todo export tiene
que ser una función**, y **toda action tiene que autenticar** o estar en la lista
`PUBLICAS`. Ninguna de éstas es pública. `export const f = action(_f)` **sí** es válido —
está verificado en build.

- [ ] **Step 1: escribir el módulo**

`src/server/actions/professionals.ts`:

```ts
'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { action, UserError } from '@/lib/actions/result'
import { deriveModalities } from '@/lib/professionals/modalities'
import {
  createProfessionalSchema,
  updateProfessionalSchema,
  reorderProfessionalsSchema,
} from '@/lib/professionals/schema'

const WITH_SERVICE_IDS = {
  services: { select: { id: true } },
} as const

export async function getProfessionals(includeInactive = false) {
  const { businessId } = await requireBusiness()
  return prisma.professional.findMany({
    where: {
      ...(includeInactive ? {} : { isActive: true }),
      businessId,
    },
    include: WITH_SERVICE_IDS,
    orderBy: { sortOrder: 'asc' },
  })
}

/**
 * Los servicios que la dueña puede asignar: sólo los suyos.
 *
 * Devuelve las modalidades porque el formulario las necesita para pre-marcar
 * (deriveModalities) sin pedir otra vuelta al servidor.
 */
export async function getAssignableServices() {
  const { businessId } = await requireBusiness()
  return prisma.service.findMany({
    where: { businessId, isActive: true },
    select: { id: true, name: true, modalities: true },
    orderBy: { sortOrder: 'asc' },
  })
}

/**
 * Que los servicios pedidos sean de este negocio. Un id ajeno no es un error de
 * validación de forma — es un intento de colgarle a alguien el servicio de otro
 * negocio — así que va por ForbiddenError y no por UserError.
 */
async function assertServicesOwned(businessId: string, serviceIds: string[]) {
  if (serviceIds.length === 0) return
  const owned = await prisma.service.count({
    where: { id: { in: serviceIds }, businessId },
  })
  if (owned !== serviceIds.length) {
    throw new ForbiddenError('Uno o más servicios no pertenecen a este negocio')
  }
}

async function _createProfessional(data: Record<string, unknown>) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('create-professional', 30, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createProfessionalSchema.safeParse(data)
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const serviceIds = parsed.data.serviceIds ?? []
  await assertServicesOwned(businessId, serviceIds)

  // Sin modalidades explícitas se derivan de los servicios asignados. Dejar el
  // default del schema (on_site) dejaría un servicio online-only sin nadie que
  // lo pueda dar, y el negocio no se enteraría.
  let modalities = parsed.data.modalities
  if (!modalities) {
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds }, businessId },
      select: { modalities: true },
    })
    modalities = deriveModalities(services)
  }

  // El último de la lista: el orden lo define la dueña y quien llega, llega al
  // final. `_count` no sirve — con bajas y altas los sortOrder tienen huecos.
  const last = await prisma.professional.findFirst({
    where: { businessId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  })

  const created = await prisma.professional.create({
    data: {
      businessId,
      name: parsed.data.name,
      bio: parsed.data.bio ?? null,
      modalities,
      sortOrder: last ? last.sortOrder + 1 : 0,
      services: { connect: serviceIds.map((id) => ({ id })) },
    },
    include: WITH_SERVICE_IDS,
  })

  revalidatePath('/dashboard/equipo')
  await revalidateBusinessPublicPaths(businessId)
  return created
}

export const createProfessional = action(_createProfessional)

async function _updateProfessional(professionalId: string, data: Record<string, unknown>) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('update-professional', 30, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = updateProfessionalSchema.safeParse(data)
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }
  if (Object.keys(parsed.data).length === 0) {
    throw new UserError('No hay campos para actualizar')
  }

  // El `businessId` va en el where y no en un if posterior: es el filtro de
  // pertenencia, no una comprobación aparte.
  const existing = await prisma.professional.findFirst({
    where: { id: professionalId, businessId },
    select: { id: true },
  })
  if (!existing) {
    throw new ForbiddenError('Profesional no encontrado')
  }

  const { serviceIds, ...fields } = parsed.data
  if (serviceIds) {
    await assertServicesOwned(businessId, serviceIds)
  }

  const updated = await prisma.professional.update({
    where: { id: professionalId },
    data: {
      ...fields,
      // `set` y no `connect`: destildar un servicio tiene que desasignarlo.
      // Con `connect` la lista sólo crecería.
      ...(serviceIds ? { services: { set: serviceIds.map((id) => ({ id })) } } : {}),
    },
    include: WITH_SERVICE_IDS,
  })

  revalidatePath('/dashboard/equipo')
  await revalidateBusinessPublicPaths(businessId)
  return updated
}

export const updateProfessional = action(_updateProfessional)

async function _toggleProfessional(professionalId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('toggle-professional', 20, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const existing = await prisma.professional.findFirst({
    where: { id: professionalId, businessId },
    select: { isActive: true },
  })
  if (!existing) {
    throw new ForbiddenError('Profesional no encontrado')
  }

  const updated = await prisma.professional.update({
    where: { id: professionalId },
    data: { isActive: !existing.isActive },
    include: WITH_SERVICE_IDS,
  })

  revalidatePath('/dashboard/equipo')
  await revalidateBusinessPublicPaths(businessId)
  return updated
}

export const toggleProfessional = action(_toggleProfessional)

async function _deleteProfessional(professionalId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('delete-professional', 20, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const existing = await prisma.professional.findFirst({
    where: { id: professionalId, businessId },
    select: { id: true, _count: { select: { bookings: true } } },
  })
  if (!existing) {
    throw new ForbiddenError('Profesional no encontrado')
  }

  // Quien ya atendió no se borra: la baja la saca del funnel y le deja sus citas
  // intactas. La FK de Booking es RESTRICT, así que la base rechazaría el
  // borrado igual — esto es el mensaje entendible, no el guard.
  if (existing._count.bookings > 0) {
    throw new UserError(
      'Ya tiene reservas a su nombre, así que no se puede borrar. Desactivá en vez de borrar: sale de la agenda y conserva sus citas.',
    )
  }

  // Sin reservas sí se borra de verdad: es el caso de "la cargué mal". El
  // cascade se lleva su horario y sus bloqueos, que no significan nada sin ella;
  // las filas con professionalId NULL (todo lo del negocio) no tienen FK que
  // cascadear y quedan intactas.
  await prisma.professional.delete({ where: { id: professionalId } })

  revalidatePath('/dashboard/equipo')
  await revalidateBusinessPublicPaths(businessId)
}

export const deleteProfessional = action(_deleteProfessional)

async function _reorderProfessionals(items: { id: string; sortOrder: number }[]) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('reorder-professionals', 10, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = reorderProfessionalsSchema.safeParse({ items })
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const ids = parsed.data.items.map(i => i.id)
  const owned = await prisma.professional.count({ where: { id: { in: ids }, businessId } })
  if (owned !== new Set(ids).size) {
    throw new ForbiddenError('Uno o más profesionales no pertenecen a este negocio')
  }

  await prisma.$transaction(async (tx) => {
    for (const item of parsed.data.items) {
      await tx.professional.update({
        where: { id: item.id },
        data: { sortOrder: item.sortOrder },
      })
    }
  })

  revalidatePath('/dashboard/equipo')
  await revalidateBusinessPublicPaths(businessId)
}

export const reorderProfessionals = action(_reorderProfessionals)
```

- [ ] **Step 2: pre-asignar el servicio nuevo al equipo activo**

En `src/server/actions/services.ts`, reemplazar el `prisma.service.create` de
`_createService` (hoy `:40-42`):

```ts
  // Un servicio que nadie hace no se puede reservar. Pre-asignarlo a todo el
  // equipo activo hace que ese estado sea raro en vez de el default; la dueña
  // después destilda a quien no lo haga. Con 0 profesionales activos el connect
  // queda vacío y esto no hace nada — el caso de hoy.
  const activeProfessionals = await prisma.professional.findMany({
    where: { businessId, isActive: true },
    select: { id: true },
  })

  const newService = await prisma.service.create({
    data: {
      ...parsed.data,
      businessId,
      professionals: { connect: activeProfessionals.map((p) => ({ id: p.id })) },
    },
  })
```

- [ ] **Step 3: correr los guards de CI del borde `'use server'`**

```bash
npx vitest run tests/unit/use-server-exports.test.ts tests/unit/server-actions-auth.test.ts
```
Esperado: PASS. Si falla el de auth, es porque una action nueva no autentica — no
agregarla a `PUBLICAS`, agregarle el `requireBusinessRole`.

- [ ] **Step 4: commit**

```bash
git add src/server/actions/professionals.ts src/server/actions/services.ts
git commit -m "feat(equipo): CRUD de equipo, con baja en vez de borrado para quien ya atendio"
```

---

## Task 5: la pantalla

**Files:**
- Create: `src/app/dashboard/equipo/page.tsx`
- Create: `src/components/dashboard/professional-table.tsx`
- Create: `src/components/dashboard/professional-form.tsx`
- Create: `src/components/dashboard/professional-row-actions.tsx`
- Modify: `src/components/dashboard/sidebar.tsx:30-45`

**El léxico manda en los títulos.** El rubro decide el sustantivo: el mismo botón dice
"Nuevo barbero" en una barbería y "Nueva manicurista" en un salón de uñas. Sale de
`useVocabulary()` en los componentes cliente y de `getVocabulary(business.category)` en la
página. Clavar "Profesional" recrea exactamente el problema que el track 1 vino a
resolver — y el PR 0 ya dejó las nueve claves listas (`Professionals`,
`chooseProfessional`, `noProfessionals`, …).

> **Ojo con las tres formas con artículo** (`theProfessional`, `TheProfessional`,
> `aProfessional`): en `hair_salon` y `beauty` dan "la estilista" / "la especialista", y
> **eso es una decisión de producto abierta** (el usuario todavía no la resolvió). Esta
> pantalla usa sólo los plurales y el sustantivo suelto — "Barberos", "Nuevo barbero" —
> que no llevan artículo. **No usar las formas con artículo en este PR.**

- [ ] **Step 1: la página**

`src/app/dashboard/equipo/page.tsx` — mismo molde que `services/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { ProfessionalTable } from '@/components/dashboard/professional-table'
import { getProfessionals, getAssignableServices } from '@/server/actions/professionals'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { getVocabulary } from '@/lib/vocabulary'

export default async function EquipoPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const [professionals, services] = await Promise.all([
    getProfessionals(true),
    getAssignableServices(),
  ])
  const v = getVocabulary(userData.business.category)

  return (
    <div>
      <DashboardHeader
        title={v.Professionals}
        subtitle="Quién trabaja en tu negocio y qué servicios hace cada persona."
      />
      <div className="p-5 md:p-10">
        <ProfessionalTable
          professionals={professionals.map((p) => ({
            id: p.id,
            name: p.name,
            bio: p.bio,
            isActive: p.isActive,
            sortOrder: p.sortOrder,
            modalities: p.modalities,
            serviceIds: p.services.map((s) => s.id),
          }))}
          services={services}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: el ítem de menú, con el label del léxico**

En `src/components/dashboard/sidebar.tsx`: el label depende del rubro, así que `navItems`
deja de poder ser una constante de módulo. Convertirlo en función y llamarla adentro del
componente:

```tsx
import { useVocabulary } from '@/components/vocabulary-provider'
import type { Vocabulary } from '@/lib/vocabulary'
```

Sumar `UsersRound` al import de `lucide-react` (`Users` ya lo usa Clientes, y dos ítems
con el mismo ícono se leen como el mismo lugar).

```tsx
// El label de Equipo lo decide el rubro ("Barberos", "Manicuristas"), así que la
// lista no puede ser una constante de módulo.
function buildNavItems(v: Vocabulary) {
  return [
    { href: '/dashboard', label: 'Resumen', icon: LayoutDashboard },
    { href: '/dashboard/bookings', label: 'Reservas', icon: MessageSquareText },
    { href: '/dashboard/calendar', label: 'Calendario', icon: CalendarDays },
    { href: '/dashboard/services', label: 'Servicios', icon: Scissors },
    { href: '/dashboard/equipo', label: v.Professionals, icon: UsersRound },
    { href: '/dashboard/availability', label: 'Horarios', icon: Clock3 },
    { href: '/dashboard/customers', label: 'Clientes', icon: Users },
    { href: '/dashboard/payments', label: 'Pagos', icon: CreditCard },
    { href: '/dashboard/promociones', label: 'Promociones', icon: Ticket },
    { href: '/dashboard/fidelizacion', label: 'Fidelización', icon: Sparkles },
    { href: '/dashboard/campanas', label: 'Campañas', icon: Megaphone },
    { href: '/dashboard/paquetes', label: 'Paquetes', icon: Package },
    { href: '/dashboard/billing', label: 'Facturación', icon: ReceiptText },
    { href: '/dashboard/reviews', label: 'Reseñas', icon: Star },
    { href: '/dashboard/settings', label: 'Configuración', icon: Settings },
  ]
}
```

Adentro de `DashboardSidebar`, arriba de `const pathname`:

```tsx
  const v = useVocabulary()
  const navItems = buildNavItems(v)
```

Borrar la constante `navItems` de módulo. `const mobileItems = navItems.slice(0, 4)` se
queda como está — los cuatro primeros no cambian, Equipo entra quinto y el menú móvil
sigue igual.

- [ ] **Step 3: el diálogo de alta/edición**

`src/components/dashboard/professional-form.tsx`, calcado de `service-form.tsx` (diálogo,
`useId`, estado local, `res.ok`):

- Campos: nombre (`Input`), bio (`Textarea`), checkboxes de servicios, checkboxes de
  modalidades (`MODALITY_ORDER` + `MODALITY_LABELS` + `MODALITY_HINTS` de
  `@/lib/services/modality`).
- **Pre-marcado en el alta:** todos los servicios activos tildados, y las modalidades en
  `deriveModalities(serviciosTildados)`.
- **Al tocar un servicio en el alta**, recalcular las modalidades con `deriveModalities`.
  En la **edición no**: ahí las modalidades son una decisión ya tomada por la dueña
  ("Juan no viaja") y recalcularlas se la pisaría en silencio.
- Los checkboxes de modalidad se pueden ajustar a mano en los dos modos, y no se puede
  quedar en cero (mismo `prev.length === 1 ? prev : …` que `service-form.tsx:144`).
- Textos con el léxico: `Nuevo ${v.professional}` / `Editar ${v.professional}`.

- [ ] **Step 4: las acciones de fila**

`src/components/dashboard/professional-row-actions.tsx`, calcado de
`service-row-actions.tsx`: editar (abre el diálogo), activar/desactivar, borrar.

El borrado sólo se ofrece a quien **no tiene reservas**; el `UserError` del servidor se
muestra tal cual si igual se intenta. La tabla no conoce el conteo de reservas, así que el
botón se ofrece siempre y el mensaje del servidor es el que educa — es la misma
información, una vuelta más tarde, y evita cargar un `_count` en cada lectura de la
pantalla.

- [ ] **Step 5: la tabla, con el explicador del interruptor**

`src/components/dashboard/professional-table.tsx`, calcado de `service-table.tsx`:
columnas #/orden, nombre + bio (`TruncatedCell`), servicios (cuántos), modalidades,
estado (`StatusBadge`), acciones. Versión móvil con `TableMobileCard`. Reordenar con
`reorderProfessionals`.

Lo propio de esta pantalla es el explicador. **Es el único lugar de la app donde se dice
qué cambia al sumar gente**, y sin él la dueña agrega a la segunda persona y el funnel le
cambia sin aviso:

```tsx
const activeCount = professionals.filter(p => p.isActive).length

// Qué cambia según cuánta gente activa hay. La presencia de filas activas ES el
// interruptor del multi-profesional (no hay flag que configurar), así que la
// dueña tiene que poder anticipar el salto de 1 a 2 antes de darlo.
const switchHint =
  activeCount === 0
    ? `Sin ${v.professionals} tu agenda funciona como hasta ahora: un solo horario para todo el negocio.`
    : activeCount === 1
      ? `Con una sola persona activa nadie tiene que elegir al reservar: se asigna sola.`
      : `Al reservar, tus clientas eligen con quién se atienden.`
```

- [ ] **Step 6: correr lint y tsc**

```bash
npx eslint src tests
```
Esperado: 0 errores (33 warnings preexistentes).

```bash
rm -rf .next/dev/types && npx tsc --noEmit
```
Esperado: **17 errores, todos en `tests/`** (`metrics.test.ts`, `reward-email.test.ts`),
idénticos a los de `main`. **No filtrar por `^src/`** — esconde justamente los de `tests/`.
Cero errores nuevos, y cero en cualquier archivo de este PR.

- [ ] **Step 7: commit**

```bash
git add src/app/dashboard/equipo src/components/dashboard/professional-table.tsx src/components/dashboard/professional-form.tsx src/components/dashboard/professional-row-actions.tsx src/components/dashboard/sidebar.tsx
git commit -m "feat(equipo): pantalla de equipo con el sustantivo de oficio del rubro"
```

---

## Task 6: el test de la pantalla

**Files:**
- Test: `tests/unit/professional-table.test.tsx`

**Trampa que ya mordió dos veces:** `renderToStaticMarkup` + `useRouter()` tira sin un
mock de `next/navigation`. Copiar el mock de un test existente
(`tests/unit/customer-detail-page.test.tsx`) en vez de escribirlo de cero.

- [ ] **Step 1: escribir los tests**

Casos que valen (y que fallarían si alguien clava los textos):

```ts
it('el título usa el sustantivo del rubro, no "Profesionales"', …)   // barber → "Barberos"
it('con 0 activos avisa que la agenda sigue como hasta ahora', …)
it('con 1 activo avisa que se asigna sola', …)
it('con 2+ activos avisa que la clienta elige', …)
it('muestra a los inactivos con su badge', …)
it('el estado vacío usa noProfessionals del léxico', …)
```

El del léxico es el que protege el trabajo del PR 0: renderizar la tabla envuelta en
`VocabularyProvider` con `getVocabulary('barber')` y afirmar que el markup contiene
`Barberos` y **no** contiene `Profesionales`.

- [ ] **Step 2: correr**

```bash
npx vitest run tests/unit/professional-table.test.tsx
```
Esperado: PASS.

- [ ] **Step 3: commit**

```bash
git add tests/unit/professional-table.test.tsx
git commit -m "test(equipo): la pantalla toma el sustantivo del rubro y explica el interruptor"
```

---

## Task 7: el test de integración (corre sólo en CI)

**Files:**
- Test: `tests/integration/professionals.test.ts`

**No se puede correr local:** no hay Postgres ni Docker, y el `.env.local` del checkout
principal apunta a producción. `requireTestDatabase()` (`tests/integration/setup.ts`)
aborta si la `DATABASE_URL` no parece local o de test — **no lo saltees y no apuntes esto
a producción.** Se verifica en el CI del PR.

Molde exacto: `tests/integration/service-modality.test.ts` (misma forma, mismo seed de
`bank-transfer-seed`, mismo `afterAll` que limpia).

- [ ] **Step 1: escribir los casos**

Lo que sólo la base puede probar — es decir, lo que justifica el archivo:

```ts
it('una persona creada sin modalidades queda en el local (default de la columna)', …)
it('guarda y devuelve varias modalidades', …)  // el enum array, como en Service
it('la relación con servicios va y vuelve', …)  // connect + include
it('set desasigna: destildar un servicio lo saca de verdad', …)
it('borrar a una persona se lleva SU horario y deja el del negocio intacto', …)  // el cascade selectivo
it('borrar a una persona con una reserva lo rechaza la base (RESTRICT)', …)
it('las reservas viejas quedan con professionalId null', …)
```

Los dos del medio son los que valen el archivo entero: **el cascade selectivo** (borrar a
alguien no puede tocar las filas con `professionalId IS NULL`) y **el `RESTRICT`** son
propiedades del DDL, no del código, y un test de unidad no las puede ver. Si la migración
se escribió mal, éstos son los que avisan.

- [ ] **Step 2: commit**

```bash
git add tests/integration/professionals.test.ts
git commit -m "test(equipo): la migracion de verdad — cascade selectivo y RESTRICT en reservas"
```

---

## Task 8: verificación completa y PR

- [ ] **Step 1: la suite entera**

```bash
npx vitest run
```
Esperado: la línea base es **254 archivos / 1855 tests** en `main`. Con este PR suben los
archivos nuevos; **cero fallas**. Los de `tests/integration` se saltean solos sin base.

- [ ] **Step 2: lint y tsc otra vez**

```bash
npx eslint src tests && rm -rf .next/dev/types && npx tsc --noEmit
```
Esperado: 0 errores de lint (33 warnings), 17 errores de `tsc` **todos preexistentes en
`tests/`**.

- [ ] **Step 3: el build, que es lo que corre CI**

```bash
npm run build
```
Esperado: compila. Es el único que ve los errores de tipos de las rutas de Next, que
`vitest` y `eslint` no miran.

- [ ] **Step 4: revisar el diff con ojos de reviewer**

```bash
git diff main...HEAD --stat
```
Chequear que **no aparezca ninguno** de estos: `slots.ts`, `effective-blocks.ts`,
`validation.ts`, `time-blocks.ts`, `availability.ts`, `bookings.ts`, `draft.ts`,
`public.ts`, `wizard.tsx`, `templates.ts`. Si alguno está en el diff, el PR se pasó de
alcance y ese cambio va al PR B/C/D.

- [ ] **Step 5: abrir el PR**

Cuerpo en castellano, y que diga explícitamente:
- que nadie ve un cambio de comportamiento, y **por qué** (ninguna query existente filtra
  por persona todavía);
- que si un negocio da de alta gente con esto mergeado y sin el PR B, la agenda sigue
  siendo la del negocio y los datos esperan;
- las tres decisiones de este plan: `RESTRICT` en `Booking`, borrado duro sólo sin
  reservas, modalidades derivadas de los servicios;
- que la decisión de "la estilista" sigue abierta y que esta pantalla no usa las formas
  con artículo.

**No mergear.** El merge lo autoriza el usuario, PR por PR.

- [ ] **Step 6: restaurar el cliente de Prisma para las otras sesiones**

Después del merge, no antes:

```bash
git -C /Users/robertozamorautrera/Projects/agendita checkout main -- prisma/schema.prisma
npx prisma generate
```

---

## Auto-revisión del plan

**Cobertura del spec** (fila A de la tabla de PRs): modelo `Professional` → Task 1;
relación con servicios → Task 1 + Task 4 (las dos direcciones de pre-asignación);
`professionalId` nullable en las 4 tablas → Task 1; pantalla de equipo → Task 5;
modalidades → Tasks 1/2/3/5; baja sin borrado → Task 4 + el `RESTRICT` de Task 1. La
entrada de rate limit → Task 4 (con args explícitos, como hace `services.ts`; no hace
falta tocar `RATE_LIMITS` porque `checkRateLimit` sólo cae en la tabla cuando no le pasan
límite). Revalidación de la caché pública → `revalidateBusinessPublicPaths` **con `await`**
en las cinco actions.

**Fuera de este PR, a propósito:** los contadores de onboarding y la siembra de las 7
reglas con `professionalId: null` (van al PR B, junto con las queries que empiezan a
filtrar); el equipo en el payload público (PR D, cuando el funnel lo muestre).

**Tipos consistentes:** `deriveModalities(services: { modalities: ServiceModality[] }[])`
se llama igual en la Task 2, en `_createProfessional` (Task 4) y en el formulario (Task 5).
`serviceIds` es el nombre en el schema (Task 3), en las actions (Task 4) y en el prop de la
tabla (Task 5) — no `services` en un lado y `serviceIds` en el otro.

**Sin placeholders:** los pasos de la Task 5 describen componentes calcados de un archivo
concreto y nombrado en vez de pegar 300 líneas de JSX; el criterio de "está bien" es el
archivo modelo más los puntos propios listados. Los de las Tasks 6 y 7 listan los casos
por nombre con la razón de cada uno.
