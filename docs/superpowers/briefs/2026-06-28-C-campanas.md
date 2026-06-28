# Brief — C · Campañas / Alcance (outreach)

> **Brief, no spec.** Índice: `../2026-06-28-promotions-loyalty-roadmap.md`

## Visión

La capa de **entrega**: segmentar clientas y hacerles llegar promos (A) y progreso
de fidelidad (B) por **WhatsApp** (links de un toque) o email. Cierra el loop
del endgame: B genera el premio → C lo entrega.

## Decisiones ya tomadas

- **WhatsApp-first.** No hay envío automático masivo (no WhatsApp Business API en A);
  el patrón es **links `wa.me` de un toque** que la dueña dispara (igual que el
  "Pedir reseña por WhatsApp" que ya construimos).
- **Email vía Resend** (hoy con la API key caída — ver pendientes operativos).
- **Segmentos** (sobre datos que ya existen): cumple del mes (`Customer.birthDate`),
  inactivas hace X días (`lastBookingAt`), frecuentes, con saldo pendiente,
  con/sin reseña.

## Preguntas abiertas (para el brainstorming de C)

- Mecánica de "envío en lote" sin API de WhatsApp: ¿lista de links de un toque que
  la dueña recorre? ¿cola? ¿WhatsApp Business API como evolución?
- Tracking/métricas de campaña (enviadas, abiertas, canjeadas) y su modelo de datos.
- Plantillas de mensaje configurables.
- Relación con `PromotionGrant` de B (una campaña emite grants a un segmento).

## Dependencias

- **A** (promos a entregar) + **B** (premios de fidelidad, segmentos por puntos).
- Capa de notificaciones existente (`src/lib/notifications/*`, patrón `wa.me`).
- Datos de cliente ya disponibles: `birthDate`, `lastBookingAt`, reseñas, saldo.
- **Resend** funcional para el canal email.
