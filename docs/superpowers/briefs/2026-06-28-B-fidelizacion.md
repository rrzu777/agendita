# Brief — B · Fidelización / Gamificación (puntos)

> **Esto es un brief, no un spec.** Captura visión + decisiones + preguntas abiertas
> para retomar con un brainstorming real cuando le toque (después de A).
> Índice: `../2026-06-28-promotions-loyalty-roadmap.md`

## Visión

Capa de fidelización gamificada montada **sobre el motor de A**. Los **puntos son la
moneda base**; sellos, niveles e insignias se derivan. La dueña gestiona todo desde
el panel; la clienta ve su progreso por un **link mágico "Mi tarjeta"** (sin login
hasta D).

## Decisiones ya tomadas

- **Puntos = moneda única.** Sellos ("8/10 → gratis") = umbral de puntos; niveles =
  puntos/gasto acumulado; insignias = logros; rachas = constancia.
- **Dos lados:**
  - **Acumular (earn):** eventos del negocio → `LoyaltyLedger` (+puntos). Eventos:
    reserva *Completada*, reseña dejada, referida, asistió en su cumpleaños.
  - **Canjear (spend):** puntos → **otorgar una promo** reusando el engine de A
    (`triggerType=granted`).
- **Superficie clienta = link mágico tokenizado** (mismo patrón que el link de
  reseña), no dashboard logueado, hasta que llegue D.
- **Todo configurable por negocio** (principio transversal).
- `granted` necesitará un **`PromotionGrant`** (promo + clienta + token + expira +
  usada) — ya previsto en el spec de A como nota de compatibilidad.

## Entidades bosquejadas (a confirmar en el spec)

- `LoyaltyConfig` (por negocio): `pointsPerVisit`, `pointsPerCLP`, `stampGoal`,
  definición de niveles, on/off.
- `LoyaltyLedger` (append-only): `customerId`, `points` (delta con signo), `reason`
  (visit/review/referral/redemption/adjustment), `bookingId?`, `metadata`, `createdAt`.
  Saldo = suma.
- `PromotionGrant`: emisión de una promo a una clienta puntual (cumpleaños, premio).

## Catálogo de fidelizaciones (todas son "una condición" más)

cumpleaños · sellos/tarjeta · win-back inactivas · referidas · **reseña → recompensa**
(engancha con el flujo de reseñas existente) · primera visita · aniversario (1 año) ·
niveles VIP · **paquetes/bonos prepagados** (más grande — quizá su propio sub-módulo).

## Preguntas abiertas (para el brainstorming de B)

- UI de configuración de acumulación (puntos por visita vs por gasto) y de niveles.
- Cómo es el **catálogo de canje** (puntos → qué promo) y su UX.
- ¿Paquetes/giftcards entran en B o son módulo aparte? (probablemente aparte)
- Taxonomía de insignias/logros y rachas.
- Diseño de la página "Mi tarjeta" (link mágico): qué ve la clienta.
- Precedencia cuando varias condiciones automáticas matchean una reserva.

## Dependencias

- **A** (motor `Promotion`/`Redemption` + `isRedeemable`).
- **Evento "reserva completada"** (hoy `updateBookingStatus(completed)` ya genera el
  reviewToken — ahí mismo se emitiría el evento de puntos).
- **Reseñas** (para reseña→recompensa).
- La enforcement real de límites por-clienta mejora con **D** (login).
