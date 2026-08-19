# SDD ledger — plan: docs/superpowers/plans/2026-08-18-settings-information-architecture.md

## Preflight scan

| Scope | Shared file or interface | Tasks | Ruling before dispatch |
|---|---|---|---|
| Cross-task | Section schemas and actions consumed by forms | 1 → 4, 5, 6 | Task 1 owns the contracts; later tasks consume them without widening fields or business rules. |
| Cross-task | Draft and unsaved-change APIs consumed by shell/forms | 2 → 3, 4, 5, 6, 7 | Task 2 defines the behavior; later tasks integrate it and may only extend through explicit tests. |
| Cross-task | Shared settings shell/navigation/save states | 3 → 4, 5, 6, 7 | Task 3 owns common UI; section tasks must reuse it instead of creating parallel shells. |
| Cross-task | Nested route mounting and data boundaries | 4, 5, 6 → 7 | Section components remain route-agnostic; Task 7 owns route composition and Payments isolation. |
| Cross-task | Legacy schema/action removal and compatibility tests | 1 → 8 | Keep legacy full-update compatibility through Tasks 1–7; remove only after all callers migrate in Task 8. |
| Cross-task | Payments route and bank form | 7 → 8 | Task 7 moves and isolates Payments; Task 8 verifies and removes monolith references only. |
| Process | Commit timing: build-review-ship vs SDD review-package | All | Follow SDD commit-before-review because review-package requires committed HEAD; fixes get corrective commits and re-review. Cost if wrong: extra commits, not lost work. |
| Task 1 | Schema/action field ownership and authorization | 1 | Each action derives the business from the session, rate-limits consistently, enumerates only its section fields, and retains the legacy path temporarily. |
| Task 2 | Browser navigation guard and draft recovery | 2 | Guard only dirty forms, never autosave server-side, and make local recovery versioned/recoverable. |
| Task 3 | Shared shell/navigation/save states | 3 | Reuse current design tokens and avoid decorative card grids; accessibility and responsive navigation are contractual. |
| Task 4 | Profile form/preview | 4 | Preview is local-only; persisted writes use only Task 1 profile action. No uploader. |
| Task 5 | Reservation form | 5 | Preserve all booking/cancellation/push business rules; only reorganize presentation and section-scoped persistence. |
| Task 6 | Policies form | 6 | Preserve policy semantics and revision behavior; use only section action. |
| Task 7 | Routes and Payments | 7 | Read installed Next 16 docs before route work; every page enforces owner/admin independently and Payments is neither queried nor prefetched elsewhere. |
| Task 8 | Monolith removal and final verification | 8 | Remove compatibility only after call-site search is empty; run focused, full, integration, E2E/build gates as specified. |

## Task progress

- Task 1 — completed — base `a933b5e6f070f201b2b26ea138a0295a7346442b`, implementation `e1a163da532e794e67ca121d31a389afd4b4c686`, review fix `393e2e1b2a28f9536218bc2586b1ed7ca32053ad`, independent re-review READY, 53/53 focused + typecheck + real PostgreSQL integration 1/1.
- Task 2 — completed — base `393e2e1b2a28f9536218bc2586b1ed7ca32053ad`, implementation `2eee9dcf7637ed9309b1ca689c288d76075df2cd`, review fix `b76f7f9dc81b2f822e96ccbdae0d477c95e0680e`, independent re-review READY, 24/24 focused + lint + typecheck.
- Task 3 — completed — base `b76f7f9dc81b2f822e96ccbdae0d477c95e0680e`, implementation `bc30cb5ab3dd415538b9203f6805eb8d2e6d7fa2`, review fix `31275c47782afc84da80c5d820941da726e3a72c`, independent re-review READY, 18/18 focused + lint + typecheck.
- Task 4 — completed — base `31275c47782afc84da80c5d820941da726e3a72c`, implementation `87df13fd2beb86ea0d3c72fd1ae9f301d90216bf`, review fixes `6b068e8bb168d5ae65780dda2a04f2c7ce53ca9c` + `f5964aa516211d9f9c1ac67a80357b8c50ef1e4e`, independent R2 re-review READY, 26/26 reviewer checks + lint + typecheck.
- Task 5 — completed — base `f5964aa516211d9f9c1ac67a80357b8c50ef1e4e`, implementation `ff904d6661a048605faef2ef7491bd557d2a522d`, independent review READY, 31/31 + 38/38 focused, lint + typecheck.
- Task 6 — completed — base `ff904d6661a048605faef2ef7491bd557d2a522d`, implementation `c500dfb8ebc5aa86f3b2130f972f3ebce9302f2a`, independent review READY, 39/39 focused + lint + typecheck.
- Task 7 — completed — base `c500dfb8ebc5aa86f3b2130f972f3ebce9302f2a`, implementation `b88cb289ee93d985f8fd06d474594622258bf504`, review fix `2c2d76f3f85b11055cffc5b8544da26cf1197da4`, independent re-review READY, 26/26 focused + lint + typecheck.
- Task 8 — completed — base `2c2d76f3f85b11055cffc5b8544da26cf1197da4`, implementation `739d539e5bcac15958ebd3ecf585b79599bd3856`, review fix `c32504bd7943c8cb2ca74dedd6f9eb91d80434f1`, independent re-review READY, 131/131 focused + 15/15 Playwright + 386/386 PostgreSQL integration + typecheck/lint/build/Prisma; full unit remains explicitly NO VERDE due 3 variable timeouts under load with focal reproductions green.
- Task 8 final cross-task audit — completed pending corrective commit SHA — MP owner/admin gates before side effects; normalized bank response baseline; authenticated current-server draft verifier with fail-closed recovery and real lifecycle; reduced-motion dialog. Final gates: 138/138 focused, 9/9 PostgreSQL focal, 16/16 Settings Playwright plus 2/2 post-fix Back/Forward, typecheck/lint/build/Prisma green. Proportional base comparison reproduced `my-bookings-cancel` timeout on `c2007e1`; full unit remains explicitly NO VERDE.
- Task 8 re-review R2 — completed pending corrective commit SHA — generation/snapshot fencing rejects stale verifier responses after edit, clear/save, discard, newer lifecycle request or unmount; conflict preserves the exact candidate; match installs authenticated current values as defaults before restoring the draft. Gates: 52/52 hook/forms, 2/2 PostgreSQL verifier, 2/2 real Back/Forward, typecheck and lint green. Build/full unit intentionally not repeated because no server, schema, dependency or build boundary changed; prior full remains NO VERDE.

## Final review

- Whole-branch exact-diff review — corrective audit applied; final independent READY remains pending — base `c2007e1` → final corrective HEAD recorded in handoff.
