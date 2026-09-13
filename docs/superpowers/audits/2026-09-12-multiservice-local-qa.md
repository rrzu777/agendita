# Multiservice local QA

Environment: isolated `feature/booking-multiservice` worktree, Node 22, disposable PostgreSQL 17 on `127.0.0.1:55439`, synthetic public fixture. No production environment files, external payments, OAuth completion, mail or SMS. The public harness was stopped and its scoped fixture removed after this check.

## Browser evidence

- Selected Corte (45 min / $15,000) and Nasal (20 min / $4,000) in place; explicit Continue.
- Valid `professional=booking-ui-carlos` preselected Carlos without removing Ana or Cualquiera disponible.
- Professional preview showed each next available slot. After booking Carlos's 09:00–10:05 interval, Carlos's next slot became 10:05 while Ana remained at 09:00.
- At 375 px, September's previous/empty days were disabled and future days exposed their actual slot counts; selected 13 September, 09:00–10:05.
- Guest submission used only synthetic name and phone; email, birth date and notes remained empty. Required/optional labels and Google alternative were visible.
- Review showed $19,000 without abono; submission reached Reserva confirmada and displayed both services, Carlos and $19,000 payable directly to the business.
- Read-only DB assertion found exactly one Booking with two ordered service lines, total/final 19,000, deposit 0, remaining 19,000, status confirmed, interval `2026-09-13T12:00:00Z`–`13:05:00Z`.
- Separate keyboard check: focus + Space selected each service; Enter on Continue reached professional selection with both services and the deep-linked professional intact.
- Local screenshots: `output/playwright/multiservice-calendar-mobile.png`, `multiservice-confirmation-mobile.png`, `multiservice-confirmation-desktop.png` (not production screenshots or committed binary artifacts).

## Review closure

First independent review: three medium issues fixed and regression-tested: pending/failed package previews cannot silently opt into package consumption; restoring an explicit professional choice consumes the original URL default; calendar block queries and recurring expansion have explicit budgets and fail closed.

Second review: a medium economic-display mismatch fixed across pre-submit summary and final confirmation. Partial packages now carry actual Booking totals, discounts, deposits and remaining balance; the nonredirect payment verification returns its post-transaction financial snapshot. UI regression links the actual `onSuccess` payload to confirmation: original 19,000 / deposit 6,000 becomes final 4,000 / deposit 1,000. Focused re-review found no further blockers.

Additional automated boundaries: invalid/duplicate professional links, unavailable service intersections, stale calendar responses, post-DST Santiago local-day conversion, render-clock hydration guard, service category optionality and query/expansion budgets.

Final acceptance-gap fix: the public client sends the price, duration, final amount and deposit it displayed as optional rejection preconditions, never financial authority. New bookings compare against the authoritative draft and transaction result; mismatch rolls back both booking and redemption. Replays compare against the persisted booking before return/hold renewal, including collision recovery, and do not reject an unchanged accepted quote merely because catalogue price/duration changed. Two independent focal reviews closed the replay findings; 22 multiservice PostgreSQL tests passed. Reload on a changed quote deliberately requires a fresh selection/review. Legacy callers that omit the quote retain their existing behavior; replay of a deactivated service remains an inherited limitation.

External verification still excluded: real Google success/PKCE, cross-subdomain cookies, real checkout/webhooks, production catalogue cleanup and deployment. None is implied by local screenshots, green build or fixture success.
