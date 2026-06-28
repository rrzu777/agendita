# Roadmap — Promociones + Fidelización (índice)

**Fecha:** 2026-06-28 · **Estado:** A diseñado (spec+plan); B/C/D/E en brief.

Iniciativa para dar promociones + fidelización gamificada a los estudios de belleza
de agendita, construida por rebanadas. Cada rebanada se construye con su propio
ciclo **spec → plan → build** cuando le toca.

## North-star (arquitectura del endgame)

**Dominio unificado:** una **`Promotion`** = `condición + recompensa + límites`, usada
por A, B y C. **El pegamento son eventos**: una reserva → *Completada* (o una reseña
creada) emite un evento → B acumula puntos → puede auto-emitir una promo
(cumpleaños / 10ª visita) → C la entrega por WhatsApp.

**Mecánica de juego (B):** los **puntos son la moneda base**; sellos, niveles e
insignias se **derivan** de los puntos.

## Estado por rebanada

| Rebanada | Qué | Spec | Plan | Código | Doc |
|---|---|:---:|:---:|:---:|---|
| **A** | Motor de promos por código (%/fijo/gratis) | ✅ revisado | ✅ 12 tasks | ❌ | `specs/2026-06-28-promotions-engine-design.md` · `plans/2026-06-28-promotions-engine-A.md` |
| **B** | Fidelización/puntos (sellos, niveles, cumpleaños) | brief | — | ❌ | `briefs/2026-06-28-B-fidelizacion.md` |
| **C** | Campañas (segmentar + WhatsApp/email) | brief | — | ❌ | `briefs/2026-06-28-C-campanas.md` |
| **D** | Login de clienta (Google OAuth + email) | brief | — | ❌ | `briefs/2026-06-28-D-login-clienta.md` |
| **E** | Multimoneda/multisite | brief | — | ❌ | `briefs/2026-06-28-E-multimoneda.md` |

## Decisiones de arquitectura ya cerradas (guían todo)

- **Motor unificado condición+recompensa** — A y B comparten engine; `Promotion`
  ya tiene `triggerType` (`code`/`automatic`/`granted`) + `conditions` JSON.
- **Puntos como moneda base** — sellos/niveles/insignias son vistas encima.
- **Una promo por reserva** (sin stacking) · **precio server-authoritative**.
- **Clienta sin login** hasta D → superficie de B = **link mágico "Mi tarjeta"**.
- **Orden:** A → B → C · **D** paralelo/después · **E** track aparte.
- **Currency-clean:** A introduce `formatMoney(monto, currency)`; nada de `es-CL`
  hardcodeado nuevo. Semilla del track E.

## Orden recomendado de ejecución

1. **Construir A** (plan listo). Base de todo.
2. **B**: spec → plan → build (con A ya construido, los planes salen reales).
3. **C**: spec → plan → build.
4. **D** y **E**: cuando se prioricen (independientes del engine).

## Pendientes operativos (no código)

- **Resend** caído (API key inválida) → rotar o migrar a Brevo.
- **Mercado Pago** sin probar e2e → guía en `~/Documents/agendita-mercadopago.md`.
