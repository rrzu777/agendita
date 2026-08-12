# Track D review round 1 — atomic account activation and live-user CAS

## Findings verified

1. `storeAuthenticatedPushSubscriptions` caught `PushDeviceLimitError` for an
   individual Customer and committed the rest of the transaction. The route
   could therefore return success for a subset while account status correctly
   remained false for incomplete coverage.
2. Scheduler success checked `authorizedUserId` but not the live
   `PushSubscription.customer.userId` relation. A Customer relink during the
   provider effect could make an old account row persist success and mark the
   booking sent.

## TDD evidence

- Unit RED: an authenticated two-Customer batch with the second Customer at the
  five-device cap resolved `1` instead of rejecting.
- PostgreSQL RED: the same real transaction committed the first association and
  resolved `1` instead of rolling back.
- Scheduler RED: relinking the Customer from `user-1` to `user-2` during the
  provider call produced `{ sent: 1, errors: 0 }` through the still-authorized
  old row.
- Focused GREEN: 3 unit files / 142 tests and the push authorization integration
  file / 3 tests.

## Fix

- Removed per-Customer cap recovery from authenticated batch storage. Any cap
  or persistence failure now escapes the callback, Prisma rolls back the full
  transaction, the route returns non-success, and PushManager cannot enter an
  active state for a partial set.
- The real PostgreSQL regression seeds two eligible Customers, lets the first
  persist, caps the second, and verifies both rollback (zero rows for the new
  endpoint) and `hasActivePushAssociation === false`.
- Scheduler account success CAS now requires both
  `authorizedUserId === revalidatedUserId` and
  `customer.userId === revalidatedUserId`. The branch is emitted only for a
  non-null user. Exact guest booking entitlement behavior is unchanged.
- The relink regression leaves the old row authorized and live, proves its
  stale provider success counts zero, prevents `cancellationReminderSentAt`,
  and exercises the existing bounded current-generation retry path.

## Verification

- `npm test`: 322 files / 2,889 tests passed.
- `npm run test:integration`: 51 files / 306 tests passed on PostgreSQL 16 after
  all 36 migrations.
- `npm run typecheck`: passed.
- `npm run lint`: passed with 0 errors and the same 35 repository warnings.
- VAPID-enabled `npm run build`: passed; 50 static pages generated.
- `npx prisma validate` and `git diff --check`: passed.

No migration was required. Real vendor delivery and installed-iOS validation
remain deployment gates.
