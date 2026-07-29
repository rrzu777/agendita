# PR 0 — Léxico de oficio por rubro

> **Para agentes:** SUB-SKILL REQUERIDA: usá `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para ejecutar tarea por tarea. Los pasos
> usan checkbox (`- [ ]`) para el seguimiento.

**Goal:** que `lib/vocabulary` sepa decir el sustantivo de oficio de cada rubro —
barbero, manicurista, estilista, especialista, terapeuta, profesional — para que las 6
superficies del track 5 no claven "Profesional" en el código.

**Architecture:** el módulo tiene hoy exactamente **dos** formas (`FEMININE` / `NEUTRAL`)
y mapea los 7 rubros a esas dos. El oficio no se reduce a dos, así que `BY_CATEGORY` pasa
de apuntar a un objeto compartido a **spread + override**:
`nails: { ...FEMININE, ...MANICURISTA }`. Las palabras de oficio viven en un tipo propio
(`ProfessionalWords`) del que `Vocabulary` extiende, así el spread queda type-safe y el
compilador caza una clave mal escrita.

Se respeta el principio declarado del módulo: **frases escritas a mano con la concordancia
resuelta**, cero trucos tipo `` `barber${v.o}s` ``. La irregularidad del castellano vive
en los datos, no en una función.

**Tech Stack:** TypeScript, vitest. **Cero superficie de Next.js** en este PR — no hay
que leer `node_modules/next/dist/docs/`.

**Alcance:** este plan cubre **sólo el PR 0**. Los PRs A–E del track tienen su diseño
cerrado en `docs/superpowers/specs/2026-07-29-multi-profesional-design.md` y cada uno
recibe su propio plan justo antes de ejecutarse — es la convención del repo, porque cada
PR depende de lo que dejó el anterior.

---

## File Structure

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `src/lib/vocabulary/index.ts` | El léxico entero: tipos, las dos formas base, las palabras de oficio y el mapa por rubro | Modificar |
| `tests/unit/vocabulary.test.ts` | Guards del léxico: paridad de claves, nada vacío, concordancia, oficio por rubro | Modificar |

Nada más. El módulo ya es una sola unidad con una responsabilidad clara y no conviene
partirlo: los consumidores importan `getVocabulary` y nada más.

**Por qué el tipo separado.** `ProfessionalWords` no es decoración: `Vocabulary extends
ProfessionalWords` es lo que hace que `{ ...FEMININE, ...MANICURISTA }` compile sólo si
`MANICURISTA` trae **todas** las claves de oficio, y lo que hace que un
`profesional: 'barbero'` mal escrito (sin la `s` inglesa) sea un error de compilación y no
una clave fantasma.

---

## Task 1: el oficio de cada rubro

**Files:**
- Test: `tests/unit/vocabulary.test.ts`

- [ ] **Step 1: escribir el test que falla**

Agregar al final de `describe('vocabulario por rubro', ...)`, antes del cierre:

```ts
  // El olvido más probable no es escribir mal una palabra — el compilador lo caza —
  // sino olvidarse de darle su oficio a un rubro y que se quede con el genérico
  // "profesional" sin que nada se queje.
  it('cada rubro dice su propio oficio', () => {
    const expected: Record<string, string> = {
      barber: 'barbero',
      nails: 'manicurista',
      hair_salon: 'estilista',
      beauty: 'especialista',
      massage: 'terapeuta',
      therapy: 'terapeuta',
      other: 'profesional',
    }
    for (const [category, noun] of Object.entries(expected)) {
      expect(getVocabulary(category as BusinessCategory).professional, category).toBe(noun)
    }
  })

  // La concordancia del artículo es lo que el módulo existe para resolver: 'la
  // manicurista' y 'el barbero' no se derivan del sustantivo.
  it('el artículo concuerda con el género del rubro', () => {
    for (const category of ['nails', 'beauty', 'hair_salon'] as const) {
      expect(getVocabulary(category).theProfessional, category).toMatch(/^la /)
      expect(getVocabulary(category).aProfessional, category).toMatch(/^una /)
    }
    for (const category of ['barber', 'massage', 'therapy', 'other'] as const) {
      expect(getVocabulary(category).theProfessional, category).toMatch(/^el /)
      expect(getVocabulary(category).aProfessional, category).toMatch(/^un /)
    }
  })
```

Y cambiar la línea 2 del archivo para importar el tipo:

```ts
import { describe, it, expect } from 'vitest'
import type { BusinessCategory } from '@prisma/client'
import { getVocabulary, interpolate, VOCABULARIES } from '@/lib/vocabulary'
```

- [ ] **Step 2: correr el test y verificar que falla**

Run: `npx vitest --run tests/unit/vocabulary.test.ts`

Expected: FAIL. Los dos casos nuevos fallan porque `professional`, `theProfessional` y
`aProfessional` no existen en `Vocabulary` — vitest los ve como `undefined`
(`expected undefined to be 'barbero'`). `tsc` además va a marcar
`Property 'professional' does not exist on type 'Vocabulary'`.

- [ ] **Step 3: implementar el tipo y las palabras**

En `src/lib/vocabulary/index.ts`, **antes** de `export interface Vocabulary`, agregar:

```ts
/**
 * Las palabras del oficio: lo único del léxico que cambia por RUBRO y no sólo por
 * género. Un barbero no es una manicurista y ninguno de los dos es "un profesional".
 *
 * Vive en su propio tipo para que `{ ...NEUTRAL, ...BARBERO }` compile sólo si están
 * todas las claves, y para que una clave mal escrita sea un error de compilación en
 * vez de una entrada fantasma que nadie lee.
 */
export interface ProfessionalWords {
  /** "barbero" | "manicurista" — el sustantivo solo */
  professional: string
  /** "barberos" | "manicuristas" */
  professionals: string
  /** "Barbero" | "Manicurista" — encabezado de tabla y etiqueta de email */
  Professional: string
  /** "Barberos" | "Manicuristas" — ítem de navegación y título de sección */
  Professionals: string
  /** "el barbero" | "la manicurista" */
  theProfessional: string
  /** "El barbero" | "La manicurista" — arranque de oración */
  TheProfessional: string
  /** "un barbero" | "una manicurista" */
  aProfessional: string
  /** "Elegí tu barbero" | "Elegí tu manicurista" — título del paso del funnel */
  chooseProfessional: string
  /** "Sin barberos" | "Sin manicuristas" — estado vacío */
  noProfessionals: string
}
```

Cambiar la declaración de `Vocabulary` para que extienda el tipo nuevo:

```ts
export interface Vocabulary extends ProfessionalWords {
  /** "clienta" | "cliente" */
  client: string
```

(el resto del cuerpo de la interfaz queda igual)

Después de la interfaz y **antes** de `const FEMININE`, agregar los seis juegos de
palabras. `manicurista`, `estilista`, `especialista`, `terapeuta` y `profesional` son de
género común — cambia el artículo, no el sustantivo; `barbero` sí está marcado:

```ts
const BARBERO: ProfessionalWords = {
  professional: 'barbero',
  professionals: 'barberos',
  Professional: 'Barbero',
  Professionals: 'Barberos',
  theProfessional: 'el barbero',
  TheProfessional: 'El barbero',
  aProfessional: 'un barbero',
  chooseProfessional: 'Elegí tu barbero',
  noProfessionals: 'Sin barberos',
}

const MANICURISTA: ProfessionalWords = {
  professional: 'manicurista',
  professionals: 'manicuristas',
  Professional: 'Manicurista',
  Professionals: 'Manicuristas',
  theProfessional: 'la manicurista',
  TheProfessional: 'La manicurista',
  aProfessional: 'una manicurista',
  chooseProfessional: 'Elegí tu manicurista',
  noProfessionals: 'Sin manicuristas',
}

const ESTILISTA: ProfessionalWords = {
  professional: 'estilista',
  professionals: 'estilistas',
  Professional: 'Estilista',
  Professionals: 'Estilistas',
  theProfessional: 'la estilista',
  TheProfessional: 'La estilista',
  aProfessional: 'una estilista',
  chooseProfessional: 'Elegí tu estilista',
  noProfessionals: 'Sin estilistas',
}

const ESPECIALISTA: ProfessionalWords = {
  professional: 'especialista',
  professionals: 'especialistas',
  Professional: 'Especialista',
  Professionals: 'Especialistas',
  theProfessional: 'la especialista',
  TheProfessional: 'La especialista',
  aProfessional: 'una especialista',
  chooseProfessional: 'Elegí tu especialista',
  noProfessionals: 'Sin especialistas',
}

const TERAPEUTA: ProfessionalWords = {
  professional: 'terapeuta',
  professionals: 'terapeutas',
  Professional: 'Terapeuta',
  Professionals: 'Terapeutas',
  theProfessional: 'el terapeuta',
  TheProfessional: 'El terapeuta',
  aProfessional: 'un terapeuta',
  chooseProfessional: 'Elegí tu terapeuta',
  noProfessionals: 'Sin terapeutas',
}

/** El genérico. Es el oficio de `other` y la base de las dos formas del léxico. */
const PROFESIONAL_NEUTRO: ProfessionalWords = {
  professional: 'profesional',
  professionals: 'profesionales',
  Professional: 'Profesional',
  Professionals: 'Profesionales',
  theProfessional: 'el profesional',
  TheProfessional: 'El profesional',
  aProfessional: 'un profesional',
  chooseProfessional: 'Elegí tu profesional',
  noProfessionals: 'Sin profesionales',
}

const PROFESIONAL_FEMENINO: ProfessionalWords = {
  ...PROFESIONAL_NEUTRO,
  theProfessional: 'la profesional',
  TheProfessional: 'La profesional',
  aProfessional: 'una profesional',
}
```

Agregar el spread al arranque de cada forma base. `FEMININE`:

```ts
const FEMININE: Vocabulary = {
  ...PROFESIONAL_FEMENINO,
  client: 'clienta',
```

`NEUTRAL`:

```ts
const NEUTRAL: Vocabulary = {
  ...PROFESIONAL_NEUTRO,
  client: 'cliente',
```

Y reemplazar `BY_CATEGORY` entero:

```ts
/**
 * Femenino en los rubros donde ya era el texto vigente — cambiarlo les movería el
 * tono a las manicuristas que ya usan el producto. Neutro en todo lo demás.
 *
 * El oficio se superpone a la forma base: el género lo decide el rubro, el sustantivo
 * también, y son dos ejes distintos. `other` no necesita override porque su oficio ES
 * el genérico que ya trae NEUTRAL.
 */
const BY_CATEGORY: Record<BusinessCategory, Vocabulary> = {
  nails: { ...FEMININE, ...MANICURISTA },
  beauty: { ...FEMININE, ...ESPECIALISTA },
  hair_salon: { ...FEMININE, ...ESTILISTA },
  barber: { ...NEUTRAL, ...BARBERO },
  massage: { ...NEUTRAL, ...TERAPEUTA },
  therapy: { ...NEUTRAL, ...TERAPEUTA },
  other: NEUTRAL,
}
```

- [ ] **Step 4: correr el test y verificar que pasa**

Run: `npx vitest --run tests/unit/vocabulary.test.ts`

Expected: PASS, los 8 casos del archivo.

- [ ] **Step 5: commit**

```bash
git add src/lib/vocabulary/index.ts tests/unit/vocabulary.test.ts
git commit -m "feat(vocabulario): el sustantivo de oficio de cada rubro"
```

---

## Task 2: cerrar el agujero de los guards

Los dos guards que ya existen —paridad de claves y "nada vacío"— iteran
`Object.values(VOCABULARIES)`, que son **sólo las dos formas base**. Los 7 objetos que
`getVocabulary` devuelve de verdad, con los overrides ya aplicados, **no los mira nadie**.
Un override que agregue una clave de más o deje una vacía pasa limpio.

**Files:**
- Test: `tests/unit/vocabulary.test.ts:18-31`

- [ ] **Step 1: escribir el test que falla**

Reemplazar los dos `it` existentes (`'todos los léxicos tienen exactamente las mismas
claves'` y `'ninguna entrada queda vacía'`) por esta versión, que cubre las dos formas
base **y** los 7 léxicos armados:

```ts
  // Los guards tienen que mirar los léxicos ARMADOS, no sólo las dos formas base:
  // BY_CATEGORY aplica overrides por rubro y es ahí donde se cuela una clave de más
  // o una entrada vacía. Iterar sólo VOCABULARIES los deja pasar.
  const EVERY_LEXICON = [
    ...Object.entries(VOCABULARIES),
    ...ALL_CATEGORIES.map((c) => [c, getVocabulary(c)] as const),
  ]

  it('todos los léxicos tienen exactamente las mismas claves', () => {
    const reference = Object.keys(VOCABULARIES.neutral).sort()
    for (const [name, lexicon] of EVERY_LEXICON) {
      expect(Object.keys(lexicon).sort(), name).toEqual(reference)
    }
  })

  it('ninguna entrada queda vacía', () => {
    for (const [name, lexicon] of EVERY_LEXICON) {
      for (const [key, value] of Object.entries(lexicon)) {
        expect(value.trim(), `${name}.${key}`).not.toBe('')
      }
    }
  })
```

Y agregar la lista de rubros arriba del `describe`, después de los imports:

```ts
// Los 7 valores de BusinessCategory. A mano y no derivada del enum de Prisma a
// propósito: si mañana se agrega un rubro, este archivo tiene que fallar para que
// alguien decida su oficio, en vez de heredar el genérico en silencio.
const ALL_CATEGORIES = [
  'nails',
  'beauty',
  'hair_salon',
  'barber',
  'massage',
  'therapy',
  'other',
] as const satisfies readonly BusinessCategory[]
```

- [ ] **Step 2: correr el test y verificar que pasa**

Run: `npx vitest --run tests/unit/vocabulary.test.ts`

Expected: PASS. Estos dos guards **no fallan al escribirse** — la implementación de la
Task 1 ya es correcta. Son red de regresión, no TDD: lo que prueban es que un override
futuro roto se vea. Para convencerse de que muerden, hacer la verificación del paso
siguiente.

- [ ] **Step 3: verificar que el guard realmente falla si se rompe**

Un guard que no se vio fallar no sirve. Meter a mano en `src/lib/vocabulary/index.ts`,
dentro de `MANICURISTA`, una clave que no existe en el tipo y una vacía:

```ts
  noProfessionals: '',
```

Run: `npx vitest --run tests/unit/vocabulary.test.ts`

Expected: FAIL con `nails.noProfessionals` en el mensaje — el `expect` lleva el nombre
de la clave justamente para eso.

**Revertir el cambio** (`git checkout src/lib/vocabulary/index.ts`) y volver a correr:
Expected: PASS.

- [ ] **Step 4: commit**

```bash
git add tests/unit/vocabulary.test.ts
git commit -m "test(vocabulario): los guards miran los 7 léxicos armados, no las 2 formas base"
```

---

## Task 3: verificación y PR

**Files:** ninguno nuevo.

- [ ] **Step 1: la suite unitaria entera**

Run: `npx vitest --run`

Expected: PASS. Ningún otro test toca `lib/vocabulary`, pero el módulo lo consumen
componentes que sí tienen tests (los presets de fidelización usan `interpolate`), así
que la suite completa es la que confirma que agregar claves no rompió a nadie.

- [ ] **Step 2: tipos**

```bash
rm -rf .next/dev/types && npx tsc --noEmit
```

Expected: sólo los **3 errores preexistentes en `tests/`** que no son de este PR. Ni uno
en `src/`.

Ojo con los dos puntos ciegos de este comando: se frena con un `.next/dev/types` viejo
(de ahí el `rm -rf`), y filtrar con `grep '^src/'` esconde los errores de `tests/` — no
filtrar.

- [ ] **Step 3: lint**

Run: `npx eslint src tests`

Expected: **0 errores, 33 warnings** — la línea base del repo, idéntica a `main`.

- [ ] **Step 4: abrir el PR**

La rama `feat/profesionales` ya trae los commits del spec. El PR 0 los lleva junto con el
léxico: el spec es el documento que explica los 5 PRs que vienen.

```bash
git push -u origin feat/profesionales
```

Cuerpo del PR: qué cambia (`lib/vocabulary` gana el eje de oficio), por qué el módulo
necesitaba overrides por rubro (dos formas no alcanzan para siete oficios), y que los
guards pasaron a mirar los léxicos armados. Mencionar que **no hay ningún consumidor
todavía** — las palabras se usan a partir del PR A — y que por eso el PR es de riesgo
nulo.

- [ ] **Step 5: esperar CI**

Los 5 checks (`build`, `lint`, `unit`, `integration`, `e2e`) más Vercel. `e2e` no es
requerido y es conocido por ser inestable.

**No mergear.** El merge lo autoriza el usuario, siempre.

---

## Self-review

**Cobertura del spec.** Este plan cubre la sección "Vocabulario (track 1) — cambio
estructural" del spec, completa: los 7 oficios de la tabla, las 9 claves nuevas
enumeradas ahí, el criterio de qué **no** entra al léxico ("Cualquiera disponible",
"Te atiende" — no varían ni por género ni por rubro, así que no son datos del módulo), y
el principio de frases a mano.

Las otras secciones del spec son de los PRs A–E y quedan fuera a propósito.

**Consistencia de tipos.** `ProfessionalWords` se define en la Task 1 y se usa con ese
nombre en los seis constantes y en `Vocabulary extends`. `ALL_CATEGORIES` se define en la
Task 2 y se usa sólo ahí. `getVocabulary` no cambia de firma. La clave se llama
`professional` (inglés, como el resto del léxico) en las tres tareas.

**Un riesgo asumido.** `ALL_CATEGORIES` duplica a mano los valores de
`BusinessCategory`. Es deliberado y está comentado: derivarlo del enum haría que un rubro
nuevo herede el oficio genérico sin que nadie lo note, y el punto del PR es justamente
que eso no vuelva a pasar.
