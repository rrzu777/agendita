# Booking hold follow-ups

## Context

The booking hold work is already on `main` through PRs #171, #172, #173 and
#174. Three bounded follow-ups remain:

1. Transfer instructions promise that the slot is released immediately after
   the displayed deadline, although the persisted payment hold can outlive the
   appointment-capped display phrase.
2. The calendar drawer's Radix portal is now renderable in jsdom, but the
   owner-facing `rescheduleBlockedReason` and payment-status precedence have no
   component-level regression.
3. `rescheduleBooking` reads the booking before opening its transaction and
   passes that snapshot into the transaction-aware core. A payment or approval
   transition between those operations can make the guard reject a booking
   using stale state. The final update is transactional, but the business rule
   is evaluated from an old snapshot.

## Decision

Deliver three independent PRs, in this order:

### Track A — transfer copy

Change the user-facing sentence to describe the deadline without promising that
the slot is released at that exact instant. Keep the existing deadline phrase
and transfer behavior unchanged. Add a focused component test that asserts the
new observable message and prevents the stale promise from returning.

### Track B — drawer regression coverage

Use the repository's jsdom/React DOM helper and a real Radix `Sheet` render,
not a mock of the drawer. Cover the two observable branches that were missing:

- an expired pending payment with a Mercado Pago payment in flight shows the
  verification state and blocks owner rescheduling;
- an expired pending payment without an in-flight payment shows the expired
  state and the corresponding owner action message.

No drawer behavior changes are intended in this track.

### Track C — transaction snapshot race

Make the transaction authoritative for the state used by the reschedule guard.
The outer read remains responsible for authorization, service data, customer
notification data, and the optimistic terminal check. Inside the transaction,
re-read the booking's status/payment/hold/approval fields through `tx` before
calling `rescheduleBookingInTx`, while preserving the original appointment and
notes used for the mutation. If the row no longer exists or the tenant changes,
return the existing user-facing state error. Add a regression test that changes
the state between the outer read and transaction callback and proves the
transaction uses the fresh state.

This avoids changing the hold domain model or introducing a new database column;
that larger migration remains intentionally out of scope.

## Quality gates

Each track follows failing-test-first TDD, focused local tests, `git diff
--check`, lint/build as appropriate, manual diff review, a GitHub PR, green
required checks, squash merge, and a fresh main-branch verification before the
next track starts.

## Non-goals

- no change to raw-status surfaces intentionally left narrow;
- no new approval/hold column;
- no automatic production configuration or data migration;
- no stacked PRs.
