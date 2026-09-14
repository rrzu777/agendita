# Refinements: domain boundaries and producer inventory

Read-only investigation on base `dda898e`. This is an implementation input, not proof of delivery.

## Customer identity

- Canonical create path: `src/lib/customers/find-or-create.ts` used by booking/dashboard/package flows. It normalizes Chilean mobile phone, takes transaction advisory lock `customer:{businessId}:{phone}` and matches exact phone. Database has `Customer_businessId_phone_key`.
- Customer edit: `src/server/actions/customers.ts`; schema already lowercases/trim email. Find-or-create should normalize internally too, so every caller gets one contract.
- Account linking: `src/lib/customers/link.ts` links by Supabase verified email, excluding business members; a `user_metadata` boolean is not trusted. Linking accounts is distinct from merging customer records. Different non-null linked users are a merge conflict.
- Relations that cannot disappear: Booking, Payment, Review, PromotionRedemption, LoyaltyLedger, PromotionGrant, Referral (both ends), PackagePurchase, CampaignRecipient, CustomerPhoto, PushSubscription and its booking entitlements. Other untyped `customerId` fields must be checked before migration.
- Collision domains: grants `(customerId, requestId)`, campaign `(campaignId, customerId)`, push `(customerId, subscriptionFingerprint)`, referred customer unique. Customer loyalty/referral tokens are unique bearer identifiers; deleting them breaks existing links. A merged alias/redirect preserves lookup and audit identity, but every reader/writer must resolve it consistently. No hard-delete shortcut.
- Financial facts remain immutable: do not sum/replace payment amounts or recompute ledger entries. Move/group ownership with provenance, preserve totals. Marketing opt-out wins over opt-in when joining records.
- Duplicate group discovery must query the entire tenant, bounded/paginated; current list is cursor-paged 50 and filters only current page. No PII in diagnostics or analytics.

## WhatsApp producer inventory

| Direction / kind | Current producer | Customization ownership |
|---|---|---|
| Business → customer, booking confirmation | `BookingContactButtons` → `buildBookingConfirmationWhatsappMessage` | Shared business template with booking facts; status must be truthful. |
| Business → customer, appointment reminder | Same component → `buildWhatsappReminderMessage` | Shared business template; no reminder for cancelled/expired record. |
| Business → customer, reschedule | `bookings/[id]/reschedule/reschedule-form.tsx` → `buildBookingRescheduledWhatsappUrl` | Shared business template; old/new dates + location preserved. |
| Business → customer, review request | `actions/reviews.ts::_getReviewWhatsappLink` currently inline; exported builder elsewhere | Consolidate duplicate renderer; preserve completed-only guard and token link. |
| Business → customer, transfer proof received | `pending-transfers-section.tsx` currently inline, separate deposit/balance text | Shared kind with verified state facts; confirm whether mounted before claiming live coverage. |
| Business → customer, campaign | `actions/campaigns.ts` → `prepareCampaignSend` → campaign `messageTemplate` | Existing campaign-specific snapshot wins. Message settings supplies editable default for new campaign; central validation/interpolation shared, no rewrite of existing campaigns. |
| Business → customer audience, share booking link | `SetupChecklist` builds inline `Reserva aquí` text | Editable share template; required public booking URL. |
| Customer → business, booking help | `step-confirmation.tsx`, `book/confirmation/page.tsx` → `buildBookingHelpWhatsappUrl` | Not a business-to-customer message; keep factual customer-authored intent, list as system-owned if shown in hub. |
| Customer → friend, referral | `loyalty/referral-share.tsx` | Not business-to-customer; preserve customer's voice, valid referral link/consent. |
| Contact-only links | public profile / customer detail | No prewritten message; no empty fake template. |
| Owner clipboard booking summary | `buildWhatsappBookingSummaryText` | Internal operational summary, not a customer template. |

## Email inventory

`src/lib/notifications/email-provider.ts` centralizes customer sends. Customer kinds include confirmation, received/pending request, transfer reminder/reactivation/rejection/expiration, balance verified/rejected, cancellation, reschedule, review request, loyalty reward, campaign, package purchase, payment receipt, appointment reminder and package transfer reminder. Business/admin subscription/analytics/incident notifications are not customer messages and stay system-owned.

Most customer payload types do not carry `businessId` today. Tenant configuration must be passed from authenticated/domain-resolved context or loaded by immutable booking/purchase ID; never look up tenant by business display name or email. No optional context that silently omits customization in cron paths. System-owned HTML shell, calendar attachments, payment and consent links remain unchanged and escaped.

## Cross-surface findings

- `pending-transfers-section.tsx` has legacy native confirmation and swallowed errors; verify reachability and replace with canonical confirmation/feedback when integrating its messages.
- Service form currently accepts invalid HEX draft by silently saving last valid selectedColor; shared picker must surface validation and preserve draft. Service preview can overflow its unwrapped price/duration/deposit line.
- Native picker is deliberately platform-owned, but label/HEX/favorites/validation are app-owned and accessible.
- Color favorites: a small tenant-scoped collection, maximum 12, uppercase six-digit HEX, unique by `(businessId,color)`. Add/remove each color idempotently under a tenant lock; no full-list replacement or localStorage cross-account leakage. Same favorites used in services and brand profile.

## Local fixture and release security

- New disposable database `agendita_refinements_20260914_test`, Docker `agendita-booking-multiservice-20260912`, loopback port 55439. 63 migrations + seed applied. Existing `agendita_owner_analytics_test` untouched.
- npm audit reports Next 16.3.2 affected by GHSA-2xp9-vwfh-vxw4 and GHSA-p293-qw3h-jr36 (patched >=16.3.3); separate narrow dependency patch before release. Sources: https://github.com/advisories/GHSA-2xp9-vwfh-vxw4 and https://github.com/advisories/GHSA-p293-qw3h-jr36 . AVIF optimizer condition must be distinguished from Windows-only hosting advisory; no evidence of compromise claimed.
- Other audit advisories: sharp runtime; fast-uri/hono/js-yaml/qs dependency paths require classification. No blanket npm audit fix --force.
# Identity continuation notes (read-only inventory)

`Customer` has 12 history/activity relation fields: bookings, payments, reviews, redemptions, loyaltyLedger, loyaltyGrants, referralsMade, referralReceived, packagePurchases, campaignRecipients, photos and pushSubscriptions, plus business/user ownership. The two referral directions are distinct foreign keys. No merge implementation may assume only bookings need moving.

Token and audience boundaries discovered during continuation: `src/lib/loyalty/token.ts` resolves cards; `src/lib/customers/link.ts` links verified email, booking sessions and possession of a card; `src/lib/loyalty/referral.ts` resolves referrers; `src/lib/campaigns/optout.ts` mutates consent; `src/lib/campaigns/segments.ts` enumerates marketing audiences; `src/lib/cron/loyalty-automatic.ts` selects automatic rewards; `/mi` and `/mi/[slug]` enumerate linked customer records; `session-prefill.ts` chooses the oldest linked customer. Retaining merged alias rows without updating these readers/writers would create duplicate campaigns, split rewards or stale access. A dedicated transactional merge contract is still required before Task 4 implementation.

Task 1 local browser RED: the old redirect prevented discovering the optional setup link. After initial implementation, keyboard/direct tabs and last-tab reload passed but 390px document width was 591px. The overflow came from offscreen absolute `sr-only` readiness spans, despite the tab rail itself scrolling. This is a real geometry regression; preserving the no-overflow assertion is required.

## Task 1 verified result

Optional setup no longer blocks Hoy. Five accessible peer tabs persist the last chosen section without writing on GET; completion is explicit, server-validated and terminal/idempotent. Checklist and tabs meet 44px targets, clipboard failure is retryable, and setup metadata renders one brand suffix. Independent review found three issues; the original implementer fixed them and a separate scoped re-review confirmed all addressed.

Evidence: 9 matched unit files / 71 tests passed in the final root run; lint and typecheck passed. `tests/e2e/onboarding-refinement.spec.ts` passed 5/5 without retries against the isolated PostgreSQL fixture (390/834/1440, keyboard, reload, measured targets, finish and transport-error retry). Three captures inspected. CI-style `APP_ENV=e2e npm run build` passed, 61 pages. No source change weakened the production Redis requirement, and no real onboarding record was completed for QA.

## Task 2 verified result

Public catalogue cards use a flexible prose column and a consistently sized action/price rail only at wide widths, stacking at tablet/phone sizes. Service and brand forms share a native/HEX picker with business-scoped favorites. The additive table is RLS-enabled and unique by tenant/color, with12favorites maximum and individually locked, idempotent add/remove actions. Selecting or saving a favorite never saves the surrounding form. Invalid colors and whole-money inputs remain visible, focused and unsubmitted; optional brand clearing persists only on ordinary profile save.

Independent initial review found seven issues. Two fix/re-review rounds closed them, including actual PostgreSQL backend-blocking evidence, real staff mutation denial, RHF focus, stale color error recovery and correct remove retry copy. Browser QA also exposed unsafe pre-hydration profile editing; the form now starts disabled until initialized, following the existing booking pattern. This costs a brief startup disabled state and prevents losing early edits. No global style/theme replacement or provider activation occurred.

Final frozen-source evidence: full lint/typecheck passed;5affected unit files27tests passed; real PostgreSQL integration3/3 passed (two preconnected independent clients, distinct PIDs, second PID observed blocked by first, limit error and canonical12 afterward). `APP_ENV=e2e npm run build` passed61pages. `CI=1 APP_ENV=e2e ... npm run test:e2e -- tests/e2e/catalogue-colors.spec.ts --retries=0` passed34/34 in27.3s on the compiled artifact with isolated fixtures. Coverage includes staff add/remove denial, two-tenant separation, cross-screen save/reload/delete/retry, no lost drafts, decimal/empty/exponent rejection and valid zero amounts, initial-HTML disabled state, keyboard and44px targets,12favorite wrapping at320/390/834/1440, and14public catalogue style/width/count combinations. All four picker captures inspected, plus representative public/profile captures.

The compiled server logged two destination-stream-closed diagnostics around fast page teardown; all request/state assertions passed. Premium strict audit still reports78repository-wide findings; five scoped hits were verified shared-component/asChild false positives. This is not a claim of global audit cleanliness or production readiness. Historical preimplementation DB RED was not recorded; the final shared-state blocking witness is current positive evidence, not a fabricated past test. Only the isolated test DB received the additive migration; deployment/migration to production remains a release gate.

## Task 3 browser boundary evidence and verified result

The original real-browser RED measured a 20-minute appointment at44px instead of≤18.67px on the unchanged56px/hour axis, and found no overflow control on a cancelled mobile card. The dedicated `reservation-calendar-refinements.spec.ts` uses fresh synthetic tenants in the guarded loopback PostgreSQL database. Genuine overlaps use different professionals to respect the real booking exclusion constraint. Tests inspect menus/drawers and clipboard only; no lifecycle/payment actions or outbound messages are submitted.

Intermediate calendar checks passed adjacent appointments at834/1440, genuine overlap, and phone-week navigation/filter preservation at320/390. Captures inspected. Geometry now reads all compared rectangles within one browser frame: serial reads had measured different frames of the existing tablet sidebar's hydration width transition. This changes the observation method, not the interval/lane expectations. Remaining full-matrix, drawer/clipboard, independent review and final-build gates are not yet claimed complete.

The initial final development-browser matrix passed14/14 in34.5s with zero retries, and focused units passed89tests across9files. Independent review then found three gaps: intervals spanning days were truncated/omitted, clipboard feedback could outlive its valid contact context, and the drawer duplicated the no-phone notice. Three additional actual-browser regressions failed as expected: an overnight booking absent from the next day, a multiday block absent from its middle day, and a75-minute appointment across Santiago's repeated hour painted14px instead of70px. These failures supersede any completion inference from the earlier green matrix. The original implementer is fixing all three review findings; full lint/typecheck/build, fresh scoped re-review and compiled-artifact browser validation remain pending. No production writes or deployment occurred.

Final result: all three findings are addressed. Calendar geometry now segments intersecting intervals by real local-day bounds, retains original detail timestamps, packs actual overlap and accounts for Santiago's 23/25-hour days. The calendar-only booking read includes intervals beginning before the visible range. Brief events have truthful bands and equivalent 44px keyboard-accessible detail controls; longer events remain direct controls. Reason-only block edits preserve both original UTC endpoints, professional and overlap tolerance, including ambiguous repeated-hour clocks. Rows and mobile cards share one primary-plus-overflow controller and retain the existing lifecycle/payment guards.

Two scoped re-review rounds closed the clipboard lifetime issue, including A → B → A: feedback and pending promises belong to a context instance, not merely equal booking content. The last four regressions were observed RED and then GREEN; final independent review returned SpecCompliance PASS / TaskQuality READY with no new issues.

Root verification: calendar boundary suite17files198tests passed before the final two-file clipboard delta; the amended contact boundary independently passed3files50tests. Final full lint/typecheck and CI-style build passed (61pages). Final compiled-artifact browser run passed20/20 in28.5s, zero retries, with disposable local PostgreSQL fixtures and no uncaught browser errors. The expanded matrix covers overnight/multiday/DST day and week geometry, mobile status menus, measured touch targets, keyboard/focus, clipboard success/failure/retry and actual synthetic-block reason-save persistence. Booking/payment lifecycle dialogs were opened but never submitted; no outgoing message was sent. Representative final mobile and repeated-hour captures were inspected again.

Premium strict remains78global/12scoped findings: ten Task3 Button-asChild/Radix actionless false positives and two existing validation-owner findings (bookings GET search and EditBlock form) carried into final release review. No global audit-cleanliness or production-readiness claim. This block is complete locally; cross-track verification and publication remain Task8.
