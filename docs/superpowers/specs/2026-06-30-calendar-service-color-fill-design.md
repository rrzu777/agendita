# Diseño — Relleno de color por servicio en el calendario (#3)

**Fecha:** 2026-06-30
**Estado:** Aprobado (diseño) — pendiente de plan de implementación
**Alcance:** Solo la visualización del calendario. Sin cambios de base de datos.

## Contexto

Hoy, en `src/components/dashboard/calendar-views.tsx`, cada reserva se pinta con un
esquema de color basado en el **estado** de la reserva:

- El **fondo** y el **texto** vienen de `statusBlockClasses` (ej. `confirmed` →
  `bg-green-50 text-green-900`). Ver líneas 65–71.
- El `pastelColor` del servicio se usa solo como **borde izquierdo de 3px**
  (`borderLeftColor: accent`, líneas 407–408).
- En la vista de mes, cada reserva es una filita con un **puntito de estado**
  (`statusDotColors`, líneas 57–63 y 260–267).

El objetivo es que el **color del servicio sea el protagonista**: relleno completo
del bloque, no solo un borde. El estado de la reserva debe seguir siendo legible de
un vistazo mediante otros canales visuales.

## Requisito

En **día, semana y mes**, el fondo de cada **reserva** debe ser el `pastelColor` del
servicio (relleno completo), cuidando el contraste del texto. El **estado** de la
reserva se sigue comunicando con puntito + atenuación/tachado. Los **bloqueos** no
cambian.

## Decisiones tomadas

1. **Aplica a las tres vistas:** día, semana y mes.
2. **Solo reservas.** Los bloqueos (`BlockBand`) siguen igual: banda gris con rayado
   diagonal. El color de servicio es exclusivo de reservas.
3. **Canal de estado = opción "D" (combinación):** puntito de estado + atenuado/tachado
   para estados negativos.

## Diseño

### 1. Relleno de color de servicio

- El fondo del bloque de reserva pasa a ser `service.pastelColor` (vía `style`
  inline `backgroundColor`, porque el color es dinámico por-servicio y no una clase
  Tailwind).
- **Fallback:** si una reserva no tiene `pastelColor` (el tipo lo marca opcional), se
  usa un gris neutro por defecto para no romper el render.
- Se elimina el uso de `statusBlockClasses` para definir el fondo/borde/texto por
  estado (ese esquema se reemplaza; ver más abajo cómo se conserva el estado).

### 2. Contraste del texto (automático)

- Un helper nuevo calcula la **luminancia relativa** del `pastelColor` y decide si el
  texto va oscuro o claro. **Objetivo medible: contraste ≥ 4.5:1 (WCAG AA)** entre el
  texto y el fondo. El helper elige el color de texto (oscuro/claro) que cumpla ese
  umbral; si ninguno lo cumple con holgura, gana el de mayor contraste.
- Ubicación: `src/lib/calendar/color.ts` (helper puro, testeable, sin dependencias de
  React): `readableTextColor(hex): 'light' | 'dark'`, un helper de ratio de contraste,
  y un helper para derivar un tono de borde.
- **Se elimina el `opacity-70`** de la tercera línea (nombre del servicio, línea 414):
  sobre un fondo oscuro deja el texto ilegible. Todas las líneas usan el color de texto
  calculado, con la misma opacidad.
- Se añade un **borde sutil un tono más oscuro** que el color del servicio, para
  separar bloques de colores parecidos o adyacentes. El borde debe garantizar un
  **mínimo de contraste contra el fondo de la tarjeta**, para que un pastel casi blanco
  no quede sin separación visible.

### 3. Estado de la reserva (opción D)

- **Paleta de puntitos rediseñada.** La actual (`completed: bg-gray-400`,
  `cancelled: bg-gray-300`) es casi invisible sobre un relleno pastel. Se define una
  **paleta de puntitos saturados** (colores plenos, no pasteles), cada uno con
  **aro/halo** (ring blanco o borde fino) para separarlo del relleno. El puntito se
  posiciona **absoluto en una esquina** del bloque, sin depender del espacio de texto.
- **Refuerzo para daltonismo (default):** además del color, cada estado lleva un
  micro-ícono/forma distinguible (p. ej. reloj = pendiente, check = confirmada/completada,
  ✕ = cancelada), para que el estado no dependa solo del color.
- **Estados negativos** (`cancelled`, `no_show`, `expired`): el bloque se **atenúa**
  (opacidad reducida) y el nombre va **tachado** (`line-through`). Hoy solo `cancelled`
  tiene `line-through`; se extiende a `no_show` y `expired`.
- **`completed` se atenúa levemente** (menos que las negativas, sin tachado) para no
  confundirse con `confirmed`, que hoy se distinguía por el gris apagado. Así se
  conserva la señal "ya pasó / hecha" de un vistazo.
- **Estados activos plenos** (`pending_payment`, `confirmed`): relleno sólido con el
  color del servicio + puntito.
- Nota: `expired` existe en `BookingStatus` pero hoy no está en los mapas de color; el
  helper de estado debe tener un valor por defecto seguro para estados no mapeados.

### 3.1. Bloques muy cortos y foco/accesibilidad (defaults)

- **Bloques mínimos (~18px, reservas de 15–20 min):** el puntito de estado va absoluto
  en la esquina y **se oculta la línea del nombre del servicio** (ya condicionada a
  `heightMin >= 45`); se prioriza hora + nombre del cliente truncado.
- **Foco/hover accesible:** se conserva el realce de hover y se agrega un **anillo de
  foco visible** para navegación por teclado sobre el bloque (`button`).

### 4. Vista de mes

- Cada filita de reserva usa el `pastelColor` del servicio como fondo (con el mismo
  helper de contraste para el texto) y conserva el **puntito de estado** que ya se
  muestra.
- Se mantiene el filtro actual que oculta `cancelled` y `no_show` en la vista de mes
  (líneas 237–239).

## Archivos afectados

- `src/components/dashboard/calendar-views.tsx`
  - `BookingBlock` (líneas 380–418): fondo = color de servicio, texto por contraste,
    borde derivado, puntito de estado con halo, atenuado/tachado en negativos.
  - `MonthView` (líneas 260–267): fondo de la filita = color de servicio.
- `src/lib/calendar/color.ts` **(nuevo)**: helpers de contraste/derivación de color
  (funciones puras).
- `BlockBand` (líneas 420–432): **sin cambios**.

## Sin cambios

- Base de datos / Prisma: `Service.pastelColor` ya existe.
- Acciones de servidor.
- Lógica de posicionamiento del timeline (`src/lib/calendar/timeline.ts`).

## Verificación

- Reservas de varios servicios/colores se ven con **relleno** y **texto legible**
  (contraste ≥ 4.5:1) en día, semana y mes.
- El **estado** se distingue de un vistazo: puntito saturado + ícono visible sobre
  cualquier color; `completed` levemente atenuada; negativas atenuadas y tachadas.
- Un **bloque mínimo** (15–20 min) muestra hora + cliente + puntito sin romper layout.
- El bloque es **enfocable por teclado** con anillo de foco visible.
- Los **bloqueos** siguen viéndose como banda gris rayada.
- El helper de contraste tiene tests unitarios: colores claros → texto oscuro; colores
  oscuros → texto claro; **el par elegido cumple ≥ 4.5:1**; hex inválido/ausente →
  fallback.
