# Agendita full UI redesign — design specification

Date: 2026-09-13  
Approved direction: Quiet Command Center / Cabina del día  
Implementation base: `origin/main` at `93e3906`

## Objective

Replace the screen-by-screen visual drift with one production system across all 53 routes while preserving existing booking, payment, permission, analytics and recovery behavior. The dashboard becomes an operational cockpit; public/client surfaces become tenant-first. The release must support beauty, barber and other service businesses without assigning gendered aesthetics to a category.

## Non-goals

- No rewrite of booking, payment or analytics domain logic unless required to preserve an existing behavior during migration.
- No activation of external providers, paid traffic, real paid bookings or legal-copy changes.
- No arbitrary dark mode. Tenant customisation is a light-theme semantic token adapter plus forced-colors support.
- No big-bang PR. Production remains releasable after each merged slice.

## Architecture

### 1. Runtime design system

`src/app/globals.css` remains the canonical Tailwind v4/runtime token source. `DESIGN.md` mirrors accepted values and `UX-CONTRACT.md` owns durable behavior. Shared primitives continue under `src/components/ui`; new repeated layout behavior belongs under `src/components/layout` or the nearest established feature owner.

Base palette: porcelain canvas, white surfaces, near-black ink, quiet borders. Semantic success/warning/danger never inherit tenant color. Static content is flat by default; overlays and sticky layers may use restrained elevation.

### 2. Tenant customisation

Add additive fields to `Business`:

- `brandColor String?`: validated `#RRGGBB`.
- `visualStyle BusinessVisualStyle`: `soft | balanced | contrast`.

`resolveBusinessTheme()` accepts `brandColor`, `visualStyle` and category, then returns contrast-safe CSS variables. Invalid/missing colors use a preset derived from category. The category only suggests the initial preset. Existing and new owners can override both values in Profile settings.

Preset meaning:

- `soft`: lighter selected surfaces and 16 px panel radius.
- `balanced`: neutral surfaces and 14 px panel radius.
- `contrast`: stronger ink/surface separation and 10–12 px panel radius.

The names remain non-gendered. Barber businesses may choose any preset and beauty businesses may choose `contrast`.

### 3. Dashboard information architecture

Eight stable destinations:

1. Hoy
2. Calendario
3. Reservas
4. Clientes
5. Catálogo
6. Crecimiento
7. Finanzas
8. Configuración

Route-backed contextual navigation:

- Catálogo: Servicios, Equipo, Disponibilidad.
- Crecimiento: Métricas, Promociones, Fidelización, Campañas, Paquetes, Reseñas.
- Finanzas: Cobros, Plan y facturación.
- Configuración: Perfil, Reservas, Políticas, Pagos.

Desktop uses a 248 px sidebar. Tablet uses an 82 px rail with accessible labels/tooltips. Phone uses Hoy, Calendario, Reservas and Más; Más exposes every role-permitted remaining destination. The grouped sidebar exposes every functional child of Catálogo, Crecimiento, Finanzas and Configuración; the local contextual navigation remains visible inside those sections for orientation. Onboarding, create/edit and details remain contextual rather than global destinations.

### 4. Shared page structures

- `DashboardPageHeader`: title, useful subtitle and one primary action.
- `DashboardContextNav`: route links with `aria-current`, visible horizontal overflow on narrow widths.
- `DashboardPanel`: quiet bordered surface; variants only for actionable attention and dark/high-contrast insight.
- `KpiStrip`: metric label, value, comparison/definition; cards are not used for prose.
- Existing semantic tables/forms/dialogs remain canonical and are visually reconciled through shared primitives.

### 5. Owner route migration

Operational routes migrate first: dashboard, calendar, bookings, customer list/detail, services, team and availability. Growth/finance/settings migrate after their shell and data owners are stable. No action, state or permission may disappear on mobile. Tables choose scroll vs stacked representation based on comparison needs.

### 6. Public booking

All public surfaces are wrapped in the business theme. The wizard presents six explicit stages while preserving current state machine:

1. Multi-service selection.
2. Optional professional, including query-param preselection and “cualquiera disponible”.
3. Date/time with real availability preview.
4. Customer data: name and phone required; email, date of birth and notes optional; address only when at-home modality requires it; Google login preserves draft.
5. Payment method and policy: deposit, total, transfer or local payment only when allowed by authoritative business/payment rules.
6. Confirmation/error state with management, calendar and communication actions.

The UI must not claim a payment method exists when the business/provider configuration does not offer it.

### 7. Client, platform and admin

The client account (`/mi`), packages, loyalty, reviews, notifications and opt-out share a tenant-first public shell. `/mi` is the multi-business switcher. Within `/mi/[slug]`, a compact client navigation exposes Próximas, Historial, Beneficios and Preferencias, while Reservar remains the primary action; reprogramming is contextual to a reservation. Owner auth uses the product shell; client auth uses the client register. Landing/legal/admin are migrated to the same tokens without inheriting irrelevant dashboard navigation.

### 8. Content and accessibility

- Spanish `es-CL`, consistent tuteo.
- “Fecha de nacimiento”, not “cumpleaños”, for the stored datum.
- Required/optional appears in field labels or group descriptions.
- 44 px minimum actionable target; visible focus; no hidden scrollbars.
- Reduced motion and forced colors are respected.
- No gradients, glass, placeholder links, native alert/confirm/prompt or decorative emoji.

## Route coverage

All current `page.tsx` routes are covered:

- Owner/admin: 27 routes under `/dashboard` and `/admin`.
- Public/client: `/`, `/b/[slug]`, `/book`, `/book/[slug]`, confirmation, `/mi` family, packages, loyalty card/link, review, notifications, opt-out and install.
- Access/legal: owner login/register/recovery, client login and the three legal pages.

The exact route-to-shell, discovery and delivery mapping lives in `docs/superpowers/audits/2026-09-13-route-redesign-coverage.md`; route inventory drift is a release failure.

Route aliases share canonical surfaces; they do not fork styling or behavior.

## Delivery and rollback

Five sequential PRs:

1. Foundation: contracts, tokens, tenant theme, settings and navigation shell.
2. Owner operations: dashboard/calendar/bookings/customers/catalog/availability.
3. Owner growth/finance/settings and admin.
4. Public profile + six-stage booking shell and confirmation states.
5. Client account/packages/loyalty/review/auth/install/landing/legal plus full-route cleanup.

Each PR completes Build → Review → Fix → Re-review → Verify → Merge. Database changes are additive in PR 1. Every later PR can roll back independently without dropping the new columns.

## Acceptance evidence

- 53/53 routes compile and render under their canonical shell.
- Unit/component tests protect theme resolution, role-aware navigation and touched workflow states.
- Lint, typecheck, targeted/full tests and production build pass, with inherited flaky baseline identified separately.
- Browser QA at 390×844, 834×1112 and 1440×1000 covers beauty and barber/neutral themes, keyboard, reduced motion and no horizontal overflow.
- Production verification uses exact deployed commit, `/api/health`, the authenticated owner session and read-only public/customer navigation. No real payment or irreversible booking is created solely for QA.
