# Sistema visual de formularios — Diseño

**Fecha:** 2026-08-19
**Estado:** propuesto para revisión
**Rama:** `feature/form-design-system`

## Contexto

Agendita conserva una paleta, tipografía y geometría general coherentes, pero sus
controles de formulario usan tres lenguajes de densidad distintos:

- los primitives `Input`, `Textarea` y `SelectTrigger`, compactos por defecto;
- la utilidad global `.studio-input`, orientada a flujos táctiles;
- overrides y controles nativos definidos por pantalla.

El desfase se hace visible en Configuración: los campos de 32 px conviven con
acciones, navegación y cards de mayor escala; los `SelectTrigger` además heredan
`w-fit`, por lo que algunos se encogen al texto. Cambiar globalmente el tamaño
base sería riesgoso: filtros, tablas y controles inline dependen legítimamente
de la densidad compacta.

## Objetivos

- Definir un contrato explícito de densidad para todos los campos y botones.
- Hacer consistente Configuración sin alterar lógica, validación ni persistencia.
- Unificar label, ayuda, error y atributos ARIA en una primitive compartida.
- Migrar el resto de formularios por grupos pequeños y verificables.
- Retirar `.studio-input` sólo cuando no tenga consumidores productivos.
- Mantener targets táctiles, legibilidad móvil y ausencia de zoom involuntario.

## No objetivos

- Cambiar la paleta, tipografía, radios o personalidad visual del producto.
- Rediseñar tablas, filtros, calendario o navegación.
- Cambiar schemas, reglas de negocio, Server Actions o contratos de datos.
- Introducir una librería de formularios, estilos o animación.
- Reemplazar checkbox, radio, file y hidden inputs nativos sin una razón concreta.
- Hacer una migración masiva en un único PR.

## Dirección visual

Se conserva el lenguaje “studio” actual: fondos crema, cards claras, bordes
sobrios, radios suaves y contraste cálido. Los campos deben sentirse parte del
contenido, no una segunda capa decorativa.

La firma del sistema será una jerarquía de densidad evidente:

| Variante | Uso | Alto | Ancho | Texto |
| --- | --- | --- | --- | --- |
| `compact` | filtros, tablas, acciones inline | 32 px | según contexto | 14 px |
| `form` | dashboard y Configuración | 44 px móvil / 40 px desktop | completo | 16 px móvil / 14 px desktop |
| `touch` | auth, reserva pública, pagos críticos | 48 px mínimo | completo | 16 px |

La diferencia es funcional, no ornamental. No se usarán gradientes, glass,
sombras nuevas ni cards adicionales para resolver densidad.

## Contrato de primitives

### Input y Textarea

`Input` y `Textarea` aceptarán `density="compact" | "form" | "touch"`.
La variante por defecto seguirá siendo `compact` para preservar compatibilidad.
Las tres compartirán bordes, estados de foco, disabled e invalid actuales.

- `compact`: comportamiento visual actual.
- `form`: `bg-card`, padding horizontal de 12 px, alto responsive y ancho completo.
- `touch`: alto mínimo de 48 px, padding horizontal de 16 px y texto de 16 px.

`Textarea` aplicará la densidad al padding y tamaño de texto, manteniendo una
altura mínima propia adecuada para contenido multilínea.

### SelectTrigger

`SelectTrigger` conservará `size="sm" | "default"` como aliases compatibles y
añadirá `density="compact" | "form" | "touch"`. `density` tendrá precedencia
cuando se entregue explícitamente. `form` y `touch` usarán `w-full`; `compact`
mantendrá `w-fit` para filtros inline.

Esta compatibilidad evita cambiar consumidores ajenos antes de migrarlos.

### Button

`Button` añadirá tamaños semánticos `form` y `touch`, sin modificar los tamaños
existentes. Los submits principales compartirán alto con el campo vecino. No se
obligará a todos los botones de una pantalla a usar la densidad del formulario:
acciones secundarias inline podrán seguir compactas.

### Field

Se creará una primitive `FormField` para eliminar wrappers y `FieldError`
duplicados. Será dueña de:

- label y marca opcional de requerido;
- texto de ayuda;
- error visible;
- IDs estables para ayuda/error;
- `aria-describedby` y `aria-invalid` entregados al control mediante render prop.

Interfaz prevista:

```tsx
<FormField id="business-name" label="Nombre del negocio" error={error}>
  {(a11y) => <Input density="form" {...a11y} />}
</FormField>
```

No será dueña de React Hook Form, Zod ni del estado de submit. Así sirve también
para selects, textareas y campos server-driven sin crear acoplamiento.

## Estados

Todos los controles compartirán las mismas reglas:

- foco: borde `ring` y halo de 3 px ya usado por las primitives;
- error: borde y halo destructivos, texto asociado y `aria-invalid=true`;
- disabled: contraste reducido y cursor coherente;
- placeholder: `muted-foreground`, nunca sustituto del label;
- ayuda y error no se muestran simultáneamente si comunican instrucciones
  contradictorias; el error tiene precedencia.

Los inputs móviles conservarán texto mínimo de 16 px para evitar zoom automático
en navegadores iOS.

## Migración

### PR 1 — Foundations y Configuración

- Añadir variantes a `Input`, `Textarea`, `SelectTrigger` y `Button`.
- Añadir `FormField` y tests de accesibilidad/variantes.
- Migrar Perfil, Reservas, Políticas y transferencia bancaria.
- Corregir selects de Configuración para ancho completo.
- Conservar `SettingsSaveBar` y su separación visual ya abordada en PR #188;
  si #188 aún no está en `main`, rebasar esta rama después de su resolución.

### PR 2 — Formularios de operación del dashboard

Migrar por familias funcionales, sin tocar tablas/filtros compactos:

- nueva/edición de reserva;
- pagos manuales y cobros;
- servicios y profesionales;
- clientes;
- promociones, campañas y fidelización.

### PR 3 — Auth y flujos públicos

- login, registro, recuperación y reset;
- reserva pública y datos de cliente;
- transferencias y compra de paquetes.

Estos flujos usarán `touch`, preservando cualquier geometría intencional como
botones redondos o campos especiales.

### PR 4 — Limpieza

- Migrar los últimos consumidores productivos de `.studio-input`.
- Retirar la utilidad sólo con `rg` en cero.
- Mantener controles nativos intencionales con comentario/allowlist.
- Añadir una regla de regresión que impida nuevos text inputs o selects nativos
  no justificados dentro de formularios de producto.

## Responsive

- 375–767 px: controles `form` de 44 px y `touch` de 48 px; una columna.
- 768–1023 px: campos mantienen ancho completo y grupos pueden usar dos columnas.
- 1024 px en adelante: `form` baja a 40 px para densidad productiva; `touch`
  conserva 48 px.
- Ningún `SelectTrigger` de formulario podrá encogerse al contenido.
- Errores largos deben envolver texto sin producir overflow horizontal.

## Accesibilidad

- Labels reales asociados por `htmlFor`/`id`.
- Ayuda y error enlazados por `aria-describedby`.
- Estados inválidos expuestos por `aria-invalid`.
- Foco visible en teclado y contraste sin depender sólo del color.
- Targets interactivos críticos de al menos 44 px.
- Mensajes de submit continúan en regiones `aria-live` existentes.

## Rendimiento

- Variantes resueltas con clases estáticas y `cn`; sin runtime de estilos nuevo.
- `FormField` no mantiene estado ni suscripciones.
- No se modifica la estrategia de React Hook Form ni se amplían `watch`.
- La migración no aumenta selects/props de Server Components ni payloads cliente.

## Verificación

Cada PR seguirá RED → GREEN y tendrá revisión antes de integrar:

- tests unitarios de clases/precedencia y compatibilidad de variantes;
- tests de `FormField` para label, help, error y ARIA;
- tests focales de cada formulario migrado;
- typecheck, lint y `git diff --check`;
- Playwright representativo en 375, 768 y 1440 px;
- checks de alto/ancho, overflow, foco y error, no sólo screenshots;
- screenshots de Configuración, nueva reserva, pagos y un flujo público;
- build cuando cambie superficie de App Router o la entrega lo requiera.

Las fallas de suite completa se compararán contra el mismo base exacto; no se
declararán verdes si sólo pasan aisladas.

## Riesgos y mitigaciones

- **Regresión global:** default compacto compatible; migración explícita por uso.
- **Clases ad hoc vuelven a divergir:** tests de precedencia y guard de callers.
- **API duplicada size/density en Select:** aliases temporales y retiro documentado
  sólo después de migrar consumidores.
- **PRs demasiado grandes:** separar foundations/Settings, dashboard y público.
- **Cambios de comportamiento accidentales:** no tocar schemas, actions ni lógica;
  tests existentes deben seguir pasando sin reescribir expectativas de negocio.
- **Conflicto con PR #188:** mantener ramas separadas y actualizar desde `main`
  únicamente después de que ese PR quede resuelto.

## Criterios de salida

- Configuración usa `form` de forma completa y consistente.
- Filtros y tablas no cambian de densidad.
- Auth/público conserva targets táctiles de 48 px.
- No hay `FieldError` duplicados en formularios migrados.
- No hay selects de formulario encogidos por `w-fit`.
- `.studio-input` queda en cero consumidores productivos antes de eliminarse.
- La matriz visual/accesible acordada está verde en cada grupo migrado.
