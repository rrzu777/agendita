# Form System Rollout Plan

**Goal:** Completar la migración del sistema de formularios en operación, clientes, marketing y flujos públicos; retirar `.studio-input` sólo cuando no queden consumidores productivos y entregar un inventario final de excepciones legacy.

**Base:** `19dbe900e5f6a2d13353386aa0471d25b3ad4162` (PR #190).

**Design contract:** `docs/superpowers/specs/2026-08-19-form-design-system.md`.

## Invariantes globales

- No cambiar schemas, Server Actions, payloads ni reglas de negocio.
- Dashboard: `density="form"`; filtros/tablas inline: `compact`; auth/público/pagos críticos: `touch`.
- `FormField` posee label, ayuda, error y ARIA de controles de texto.
- Checkboxes/radios/file/hidden nativos se conservan cuando son intencionales.
- Selects nativos productivos usan una primitive con densidad, preservando `name`, `value`, `required` y UX nativa.
- Cada track sigue RED → GREEN → revisión del diff → verificación → commit.

## Track 1 — Reservas y pagos manuales

**Superficie:** reserva manual del dashboard, selector/reasignación de profesional, búsqueda de reservas, registrar pago, verificar transferencia y cancelar/rechazar.

**Files:**

- Add `src/components/ui/native-select.tsx`
- Modify `src/components/ui/input.tsx`
- Modify `tests/unit/form-controls.test.tsx`
- Modify `src/app/dashboard/bookings/new/new-booking-form.tsx`
- Modify `src/app/dashboard/bookings/page.tsx`
- Modify `src/components/dashboard/manual-payment-dialog.tsx`
- Modify `src/components/dashboard/verify-transfer-dialog.tsx`
- Modify `src/components/dashboard/cancel-booking-button.tsx`
- Modify `src/components/dashboard/professional-field.tsx`
- Modify `src/components/dashboard/reassign-control.tsx`
- Add `tests/unit/operations-form-system.test.tsx`

**Checks:** contratos renderizados, tests de negocio existentes, 375/768/1440 para nueva reserva y pagos.

## Track 2 — Clientes

**Superficie:** búsqueda, edición, notas, fotos, paquetes y ajuste de fidelización.

**Files:**

- Modify `src/app/dashboard/customers/customer-list.tsx`
- Modify `src/app/dashboard/customers/[id]/edit-form.tsx`
- Modify `src/app/dashboard/customers/[id]/notes-form.tsx`
- Modify `src/components/dashboard/customer-photos.tsx`
- Modify `src/app/dashboard/customers/[id]/package-panel.tsx`
- Modify `src/app/dashboard/customers/[id]/loyalty-panel.tsx`
- Add `tests/unit/customer-form-system.test.tsx`

**Checks:** detalle/búsqueda existentes, foco/overflow y CRUD sin alterar acciones.

## Track 3 — Promociones, campañas y fidelización

**Superficie:** promoción, nueva campaña y campos de recompensa compartidos.

**Files:**

- Modify `src/app/dashboard/promociones/promotion-form.tsx`
- Modify `src/app/dashboard/campanas/new-campaign-dialog.tsx`
- Modify `src/components/dashboard/reward-fields.tsx`
- Add `tests/unit/marketing-form-system.test.tsx`

**Checks:** schemas/actions existentes, grupos semánticos, responsive de dialogs.

## Track 4 — Auth y público

**Superficie:** login, registro, recuperación/reset y datos de cliente del funnel público.

**Files:**

- Modify `src/app/login/page.tsx`
- Modify `src/app/register/page.tsx`
- Modify `src/app/forgot-password/page.tsx`
- Modify `src/app/reset-password/page.tsx`
- Modify `src/components/booking/step-customer.tsx`
- Add `tests/unit/public-form-system.test.tsx`

**Checks:** `touch` de 48 px, labels/ARIA, auth y funnel existentes, 375/768/1440.

## Track 5 — Limpieza y guardrail

**Surface:** últimos consumidores productivos y definición global legacy.

**Files:**

- Modify `src/app/globals.css`
- Add `tests/unit/legacy-form-style-guard.test.ts`
- Add `docs/superpowers/reports/2026-08-22-legacy-form-styles.md`

**Exit criteria:**

- `rg 'studio-input' src` devuelve cero.
- Se elimina `.studio-input` de CSS.
- El guard ejecutable impide reintroducirla y lista excepciones nativas justificadas.
- Full unit, integración, E2E, typecheck, lint, Prisma, build y diff-check verificados.
- PR revisado en HEAD exacto, checks remotos verdes y merge protegido por SHA.
