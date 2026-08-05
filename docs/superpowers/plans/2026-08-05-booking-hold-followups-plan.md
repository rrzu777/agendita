# Booking hold follow-ups implementation plan

## Shared gates

- Work only in an isolated worktree, never in the active checkout.
- For every production behavior change, add the failing regression first, run
  the focused test to prove RED, implement the smallest fix, then run GREEN.
- Run `git diff --check`, the affected unit tests, lint, and build before the
  PR. Review the diff manually for contract and scope regressions.
- Create each PR from the freshly validated `origin/main`; do not stack them.
- After each squash merge, wait for the main-branch CI/deployment result before
  starting the next track.

## Track A — transfer deadline wording

1. Extend `tests/unit/transfer-details.test.tsx` with the appointment-capped
   `deadlinePhrase="tu cita"` case and an assertion for the corrected sentence.
2. Run that test and confirm the new assertion fails against the old copy.
3. Update `src/components/booking/transfer-details.tsx` with wording that does
   not claim immediate slot release at the displayed deadline.
4. Run the transfer-details test files, diff checks, lint, and build.
5. Commit, push `feature/booking-transfer-deadline-copy`, open the PR, wait for
   checks, squash merge, and verify `main` CI/deployment.

## Track B — calendar drawer coverage

1. Build a complete fixture from the calendar booking prop type and render the
   real `BookingDrawer` with the shared React DOM helper and `open: true`.
2. Add tests for the Mercado Pago in-flight precedence and the ordinary expired
   payment hold. Assert visible status text and the owner reschedule block
   message; do not assert Radix internals or mocks.
3. Run the new test RED if it exposes an actual missing behavior; if the
   existing drawer already behaves correctly, keep this track test-only.
4. Run all affected dashboard/calendar and status unit tests, lint, and build.
5. Commit, push `feature/calendar-drawer-hold-coverage`, open the PR, wait for
   checks, squash merge, and verify `main` CI/deployment.

## Track C — fresh transaction state for rescheduling

1. Add a regression in `tests/unit/reschedule-availability.test.ts` that makes
   the outer `findFirst` return an expired/unpaid snapshot, then makes the tx
   booking read return the same booking after payment landed. Assert that the
   action proceeds and updates instead of blocking the already-paid reservation.
2. Run the focused test and prove it fails with the current stale snapshot.
3. In `_rescheduleBooking`, read the authoritative booking state through the
   transaction before calling `rescheduleBookingInTx`; preserve authorization
   and notification data from the outer query, but pass the fresh status,
   payment status, hold/approval deadlines, creation time, appointment, and
   notes required by the core. Handle a missing fresh row with the existing
   state error.
4. Ensure the transaction update remains guarded by tenant/id/status and does
   not accidentally resurrect or overwrite a concurrent terminal booking.
5. Run reschedule/status/hold tests, the full unit suite with the repository's
   extended timeout if needed, lint, and build. Review the diff for notification
   and relation regressions.
6. Commit, push `feature/reschedule-fresh-state`, open the PR, wait for checks,
   squash merge, and verify `main` CI/deployment.

## Final handoff

Report the three PR URLs, merge commits, main CI/deployment evidence, any
pre-existing validation noise, and the next operational step. Do not claim
completion without fresh command output.
