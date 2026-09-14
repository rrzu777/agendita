# Product experience refinements

## Scope and authority

Implement all nine observations from the owner's eight screenshots, plus the necessary regression fixes. The user delegated product decisions and requested the complete result. This extends the deployed redesign at `dda898e`; it is not another rebrand. Existing dirty worktrees stay untouched. Staging remains excluded. Real customer merges, bookings, payments and outbound messages are not QA fixtures.

## Decisions and acceptance evidence

| # | Requested outcome | Decision | Evidence required |
|---|---|---|---|
| 1 | Onboarding no longer behaves as an unavoidable recurring wizard | Hoy never redirects solely for unfinished onboarding. Optional initial setup uses five peer tabs, real readiness indicators, direct edit destinations and explicit completion. Completed accounts leave initial setup for Hoy; ordinary editing remains in Configuración. | Server page regression, keyboard/tab interaction, finish/error/duplicate-click tests, reload and real browser navigation. |
| 2 | Service section balanced and less monotonous | Public catalogue gives name/description the flexible column; price, duration and deposit have clear order. Consistent compact booking CTA, no content-dependent stretched buttons. Service color is a small identifying cue, never text contrast or decoration replacing content. | Long/missing descriptions, 1/3/14 services, 320/390/834/1440 widths, consistent button geometry and booking deep links. |
| 3 | Real color picker and reusable favorites | Shared accessible native color input plus HEX entry and preview. Bounded favorites persisted per business with validation and removal; reuse in service and brand configuration where appropriate. Browser-native color dialog is intentionally OS-owned. | Arbitrary valid HEX, invalid draft, keyboard controls, persisted favorites after reload, business isolation, failed-save preservation. |
| 4 | Deduplication by contact | Preserve tenant-scoped normalized-phone uniqueness and locks. Normalize emails; detect matching contacts across the full dataset, not only the page. Email alone is not identity proof. Expose reviewable duplicate groups with contact evidence and an explicit owner-confirmed merge flow protecting bookings, balances, points, packages, identity links, opt-out and auditability. Never automatically merge historical production records. | All writers inspected; normalized phone and email fixtures, shared-contact conflicts, tenant/auth guards, real-DB concurrency, transactional rollback and complete relation preservation for merge. |
| 5 | Compact booking row actions for every status | At most one primary lifecycle action and one overflow menu. Expired and terminal states use the same contact menu as active states. Only messages meaningful for the actual state are offered; clipboard feedback remains visible after menu closes. | Active/pending/expired/completed/cancelled rows, no duplicate inline controls, keyboard, copy failure/success, payment/revive/cancel guards retained. |
| 6 | Calendar faithfully displays short appointments | Separate true duration/overlap from accessible hit-area needs. No fictitious collision of 11:30–11:50 and 12:00–13:30. Exact end time is visible/accessible. Preserve real overlaps, blocks, drawer focus, phone agenda and 44px accessible controls. | Geometry assertions for adjacent short appointments and genuine overlaps; end-of-day, timezone, long labels, keyboard/touch, desktop and tablet captures. |
| 7 | Metrics readable and chart-led | Compact period/filter toolbar; custom dates appear only when selected. KPIs and meaningful trend/funnel/distribution charts precede methodology. Keep explicit coverage, cohorts, denominators and missing-vs-zero semantics. Operational booking-state chart remains useful when capture is inactive. Details/tables remain reachable. | Existing analytics invariants and URL filters; populated, zero, unavailable, partial/provisional fixtures; visual charts with equivalent accessible data; no fabricated analytics. |
| 8 | Loyalty shorter without loss of capability | Peer sections for overview/program, rewards and automatic benefits; compact current configuration summary. Recommended presets are optional discovery, not the full first viewport. Keep unsaved drafts and all existing rules, confirmation and idempotency. | All existing loyalty/preset/automatic flows; tab switching and unsaved guards; disabled/enabled/empty/error states; phone and desktop. |
| 9 | One place to customize client messages | Configuración → Mensajes with WhatsApp templates for every existing business-to-client message producer. Safe variables, preview using explicitly fictional data, defaults/reset and transactional save. Central renderer shared by menu, copy, reschedule, review, campaigns and other inventoried producers. Required appointment/payment/location facts cannot be silently lost. Email uses the same settings hub but bounded editable subject/introduction/closing, preserving transactional layout, links, consent and financial facts; no raw HTML or arbitrary interpolation. Saving never sends or activates a provider. | Producer inventory mapped to renderer; tenant/auth isolation, placeholder validation and escaping, default parity, customized real call sites, stale-save protection, no outbound effects from save/preview. |

## Direction contract

THESIS: frequent actions fit in one glance; setup and methodology do not obstruct work. OWN-WORLD: retain Geist/Plus Jakarta, neutral canvas, tenant accent and semantic status colors from DESIGN.md. STORY: configure once, operate daily, investigate only when needed. FIRST VIEWPORT: compact toolbar, useful content, one primary action per region; metrics lead with evidence and loyalty with current configuration. SIGNATURE: truthful time geometry and message previews that show the exact customer-facing result. RESPONSIVE: natural document scroll, shared tabs/menus/forms, 44px actions, narrow reflow, no lost details. No marketing claims, provider activation or changes to prices/payment policy.

## Safety and release

Each track follows build → independent review → fix → re-review → verify → commit. Maintain a requirement-to-test ledger. Use local disposable database fixtures for stateful tests, never live records. Final gates: lint, typecheck, unit, integration, E2E, production build, Premium audit, bounded visual QA and independent branch review. Publish/merge follows the ongoing user-authorized delivery workflow only after exact-head checks. Completion requires live deployment of the verified changes, safe production smoke, and every row above proven; a green build alone is not completion.

## Current evidence

- Baseline `origin/main` refreshed: `dda898e` (PR #207).
- Fresh isolated branch: `feature/product-experience-refinements`.
- Baseline focused tests: 48/48 passing in five files.
- Screenshot 1 matches `dashboard/page.tsx` unconditional incomplete-onboarding redirect.
- Screenshot 2 matches public service auto-width column containing a `basis-full` booking link.
- Screenshot 5 matches `BookingRowActions` expired/terminal `contactInline` branch.
- Screenshot 6 matches calendar `HOUR_HEIGHT=56` and 46px minimum lane height, turning a 20-minute booking into an approximately 49-minute layout interval.
- Screenshot 7: charts already exist but follow controls, opportunities, methodology and population prose.
- Dependency install reports six audit advisories; inspect affected paths before release, without automatic major dependency upgrades.
