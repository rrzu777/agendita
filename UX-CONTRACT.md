# UX Contract

## Product context

- Audience: dueñas, dueños, staff y clientes de negocios de servicios.
- Primary jobs: operar agenda, gestionar clientes/cobros y reservar/autogestionar citas.
- Target market: Chile primero; tenant determina moneda y zona horaria.
- Active locale: `es-CL` con tuteo consistente y vocabulario por categoría.
- Timezone/calendar: siempre la zona del negocio para citas y disponibilidad.
- Accessibility target: WCAG 2.2 AA.

## Business-context sources

| Domain / scope | Authoritative source | Source type | Reviewed date |
|---|---|---|---|
| Roles y acceso dashboard | `src/lib/auth/server.ts`, `src/lib/business/settings-access.ts` | Server authorization | 2026-09-13 |
| Reservas y disponibilidad | `src/lib/bookings/*`, `src/lib/availability/*` | Domain implementation + tests | 2026-09-13 |
| Pagos y abonos | `docs/payments/mercado-pago-multitenant.md`, `src/lib/bookings/payments.ts` | Maintained payment contract | 2026-09-13 |
| Analítica | `docs/operations/owner-analytics.md` | Maintained operations contract | 2026-09-13 |
| Legales | `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`, `src/app/refund-policy/page.tsx` | Published product copy; legal review remains external | 2026-09-13 |
| Rediseño completo | `docs/superpowers/specs/2026-09-13-full-ui-redesign-design.md` | Approved product design | 2026-09-13 |

## Visual contract

- Project `DESIGN.md`: root `DESIGN.md`.
- Token ownership: existing runtime canonical (model B).
- Runtime source: `src/app/globals.css`; tenant adapter: `src/lib/theme/business-theme.ts` + `BusinessTheme`.
- Drift gate: DESIGN.md lint, Premium strict audit, targeted token tests and browser computed-style checks.
- Supported themes: light base + tenant styles `soft`, `balanced`, `contrast`; forced colors remains system-owned.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Table Selection | Existing table components; no bulk selection added by redesign | Existing domain screens | page | component + E2E where selection exists |
| Select/Listbox | `src/components/ui/select.tsx` and `native-select.tsx` | Shared primitive | authored / native by existing flow | keyboard + popup |
| Date | `src/components/ui/calendar.tsx`, typed date inputs where already canonical | Shared primitive | typed / authored | locale + keyboard + E2E |
| Form | `FormField` + React Hook Form/Zod | Shared primitive + server schema | create / edit | unit + browser validation |
| Scrollbar | `src/app/globals.css` | DESIGN.md/runtime mapping | stable gutter exceptions | computed style |
| Toast | Inline `role=status/alert`; no global toast owner exists | This contract | success / warning / info / error | live-region test |
| CRUD | Existing server actions and owning route | Domain implementation | return / stay per ledger | full-flow E2E |

## Component behavior

Owner page structure is shared through `DashboardPageHeader` (also exported as
`DashboardHeader` for existing routes), `DashboardPanel`, and `KpiStrip` under
`src/components/dashboard`. Headers keep one page heading, a useful description,
and the primary action together; contextual back links use `GuardedLink`.
Panels name their region with a visible heading. KPI values use a definition list,
always include their window/definition, and distinguish unavailable data from zero.
`DashboardCatalogueNav` derives its route links and role access from the canonical
dashboard navigation registry; it does not maintain a second list of permissions.
The weekly calendar uses a chronological agenda on phones and the existing time
grid on larger viewports. Both open the same booking drawer, which returns focus
to the appointment that opened it.

Calendar hit areas are packed together across appointments and time blocks at a
minimum 44 px height; dense columns scroll internally without covering another
action or modifying appointment duration. Customer detail uses the canonical
`Switch` size `touch`: a compact track inside a 56×44 px target. Existing switch
sizes remain unchanged for other workflows.

| Component | Default | Hover | Focus | Active | Disabled | Busy | Error |
|---|---|---|---|---|---|---|---|
| Button | semantic token | tonal shift | visible ring | slight tonal press | no pointer action | stable width + status | inline/page alert |
| Icon button | accessible name | tonal surface | visible ring | tonal press | inert | stable icon region | contextual alert |
| Input | border + label | border emphasis | ring + label | n/a | muted/inert | form disabled | text + aria-invalid |
| Search | clear when non-empty | control hover | visible ring | submit/clear | inert | stable results region | recoverable message |
| Textarea | resize none | border emphasis | visible ring | n/a | muted/inert | form disabled | text + aria-invalid |
| Table/list | readable rows | row/action emphasis | focus on controls | selected state when applicable | n/a | stable panel | inline retry |

## Dataset navigation

- Admin tables: existing server pagination/filter contracts remain authoritative.
- Exploratory lists: explicit pagination or load-more when unbounded; existing bounded public catalogs render all.
- URL state: preserve current route-backed search/filter/pagination behavior; new committed filters use search params.
- Empty/no-results/error/loading: maintain panel geometry and provide one next action.
- Responsive: semantic table/scroll for comparisons; labeled cards only for independent records.

## Flow ledger

| Operation | Trigger | Pending | Success destination | Success feedback | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|---|
| Create reservation | “Nueva reserva” / public wizard | disable duplicate submit, stable CTA | confirmation/owning list | confirmation state | retain draft + actionable error | result heading/error | booking domain |
| Edit settings | “Guardar cambios” | disabled fieldset + stable CTA | stay | inline saved status | preserve draft + retry | first invalid/error | settings implementation |
| Reprogram | “Reprogramar” | preserve original booking until commit | booking detail/account | new time shown | keep original + retry | result heading | self-service domain |
| Search | input + Enter/debounce | stable result region | same route/search params | result count | clear/retry | input/results | table/search implementation |
| Cancel/back | explicit action/navigation | none | owning context | only if mutation occurred | unsaved-changes dialog | trigger/destination heading | unsaved changes provider |

## Navigation and responsive behavior

- Title: `{Página} — Agendita`; never include client PII or tokens.
- Errors: 404 distinguishes missing; route error offers retry and useful destination; protected routes redirect according to server authorization.
- Sidebar: eight global groups on desktop, 82 px rail on tablet, Hoy/Calendario/Reservas/Más bottom navigation on phone.
- Route-backed contextual navigation uses links with `aria-current=page`.
- Focus: sticky navigation reserves safe-area and `scroll-padding`; route destination exposes heading.

## Overlays and feedback

- Dialog: shared Radix-backed `Dialog`; mobile contextual navigation uses shared `Sheet`.
- Native `alert`, `confirm`, `prompt`: forbidden.
- Destructive operations name object and consequence; least destructive action receives initial focus.
- Unsaved changes: existing `UnsavedChangesProvider` controls in-app navigation and unload guard.
- Layer order: dialog > sheet/drawer > popover > persistent navigation; status remains in flow unless a shared toast is introduced later.

## Async and resilience

- Mutations are pessimistic unless an existing domain contract proves safe optimistic behavior.
- Duplicate submit is blocked at UI and domain layers.
- Settings drafts preserve local changes and detect baseline conflict.
- Session expiry returns through approved auth flow without exposing draft/PII in URL.
- Stale requests are ignored/cancelled by existing search/action owners.

## Validation

- Zod server/client schema + React Hook Form for maintained forms.
- Text errors associated with fields; no native bubbles; preserve values.
- Secrets stay masked and out of analytics/storage unless domain contract explicitly allows.

## Permission and clipboard

- Navigation items are hidden when role cannot access them; server authorization remains mandatory.
- A 403/missing-role explanation is preferred when the user reaches a known protected capability directly.
- Disabled actions explain why when not self-evident.

## Migration status

- Ledger: `docs/superpowers/plans/2026-09-13-full-ui-redesign.md`.
- Current slice: foundation/theme/navigation, then owner, public booking, customer/platform.
- Rollback: one PR per vertical slice; database changes remain additive until every consumer is migrated.

## Verification

- Static: lint, typecheck, targeted Vitest, production build, Premium strict audit, Impeccable detector.
- Browser: 390×844, 834×1112, 1440×1000; keyboard, reduced motion, empty/error/loading where applicable.
- Tenant matrix: beauty (`mimosnails`) and neutral/barber preset; custom color contrast checked.
- Production: exact deployed commit, health endpoint, owner session in Brave/Chrome, public booking smoke test without creating a paid/real reservation.
