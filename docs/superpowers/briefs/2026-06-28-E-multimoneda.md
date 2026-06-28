# Brief — E · Multimoneda / Multisite

> **Brief, no spec.** Índice: `../2026-06-28-promotions-loyalty-roadmap.md`

## Visión

Que la app sirva a negocios de **distintos países/monedas** (mismo idioma:
Chile/México/Argentina/Colombia = español). Track **independiente** de A/B/C/D.

## Decisiones ya tomadas

- El modelo **ya está medio listo**: `Business.currency` (default `CLP`),
  `country` (`CL`), `timezone` ya existen y son por-negocio.
- Lo que está hardcodeado es el **formateo** (`toLocaleString('es-CL')`, `$`) y algo
  de wording.
- **A se construye currency-clean** (`formatMoney(monto, currency)` ya sembrado) para
  no sumar deuda.

## Los tres niveles (dificultad muy distinta)

1. **Formateo + wording** — centralizar `formatMoney` y reemplazar los `es-CL`/`$`
   hardcodeados; wording mínimo si es mismo idioma. **Piola** — esto es el core de E.
2. **Decimales / minor-units** ⚠️ — CLP = 0 decimales, USD/EUR/MXN = 2. Hoy los
   montos son `Int` en unidades enteras (pesos). Soportar centavos exige una
   convención de minor-units → toca pricing, pagos, ledger. **El cacho real.**
3. **Payment provider por país** — Mercado Pago es LatAm; otro país = otro proveedor.
   **Complejo, diferido.**

## Preguntas abiertas (para el brainstorming de E)

- Decisión de representación de plata (minor-units vs scaling por moneda).
- ¿Qué países/monedas primero?
- Abstracción del proveedor de pago.
- Inventario de strings a centralizar (`formatMoney` + auditar `es-CL` regados).

## Dependencias

- `formatMoney` (sembrado en A) es la semilla del nivel 1.
- Niveles 2 y 3 son independientes y de mayor envergadura.
