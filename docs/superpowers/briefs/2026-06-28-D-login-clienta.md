# Brief — D · Login de clienta

> **Brief, no spec.** Índice: `../2026-06-28-promotions-loyalty-roadmap.md`

## Visión

Cuentas para las **clientas finales** (Google OAuth + email/formulario) para que
tengan una experiencia self-serve: ver su tarjeta de fidelidad, su historial, sus
reservas, y canjear sola. Enriquece la superficie de B (la página "Mi tarjeta" pasa
de link mágico a experiencia logueada).

## Decisiones ya tomadas

- **Va después de A/B/C** — track **paralelo/independiente**, no bloquea la
  fidelización (que arranca con link mágico).
- **Es más grande de lo que parece:** cambia **todo el flujo de reserva** (hoy es
  anónimo por teléfono) e introduce un **segundo tipo de usuario** junto a las
  dueñas en Supabase Auth.
- Cuando llegue, **`maxPerCustomer` de las promos se vuelve enforceable de verdad**
  (hoy es best-effort: el teléfono no está verificado).

## Preguntas abiertas (para el brainstorming de D)

- Modelo de **multi-rol** en el mismo proyecto Supabase (dueña vs clienta): roles,
  guards, separación de dashboards.
- **Vincular** los `Customer` existentes (keyed por teléfono) a las cuentas nuevas
  (¿por teléfono? ¿email? ¿merge?).
- Cambios al flujo de reserva: ¿login opcional u obligatorio? ¿la clienta logueada
  puede reprogramar/cancelar sola?
- Reuso del Supabase Auth actual (OAuth Google) — ya hay infra para dueñas.

## Dependencias

- **Independiente** del motor A/B (no lo bloquea ni lo necesita).
- **Enchufa** a la superficie "Mi tarjeta" de B cuando exista.
- Toca el flujo de reserva público (wizard) y `Customer`.
