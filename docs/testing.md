# Testing Guide

## Quick Start

```bash
# Install dependencies
npm ci

# Run all unit tests (563 tests, 32 files)
npm test

# Run integration tests (requires local Postgres)
npm run test:integration

# Run E2E tests (requires production build)
npm run build && npm run test:e2e

# Lint
npm run lint
```

## Test Suites

### Unit Tests (`npm test` / `npm run test:unit`)

Run with Vitest in jsdom environment. All deterministic, no database needed.

```
tests/unit/
  slots.test.ts                    # generateSlots
  availability-validation.test.ts # assertSlotIsAvailable
  finance-service.test.ts          # applyApprovedPayment
  tenant-resolver.test.ts          # Tenant resolution
  payment-factory.test.ts          # Payment provider factory
  booking-payments.test.ts         # Booking payment assertions
  ...
```

**Key rules:**
- Use `vi.useFakeTimers()` + `vi.setSystemTime()` for deterministic dates
- Mock Prisma with `vi.mock('@/lib/db/prisma', ...)`
- No real dates -- all time-dependent tests use controlled clocks
- Integration tests excluded via vitest.config.ts `exclude`

### Integration Tests (`npm run test:integration`)

Run against a real PostgreSQL database. **Never runs against production.**

```bash
# Set up a local test database
cp .env.test.example .env.test
# Edit .env.test with your local Postgres URL

# Create database
createdb agendita_test

# Run migrations and tests
npx prisma migrate deploy
npm run test:integration
```

**DB Guard:** Tests abort if `NODE_ENV=production` or `DATABASE_URL` doesn't appear to be a local/test database.

**CI:** GitHub Actions spins up a `postgres:16` service container and runs migrations before tests.

### E2E Tests (`npm run test:e2e`)

Playwright tests against a running server. Uses production build for stability.

```bash
npm run build
npm run test:e2e
```

**Configuration:** `playwright.config.ts` -- single worker, chromium only, production build.

**Tests cover:**
- Public pages load (landing, book listing, business profile)
- Login/register pages are accessible
- Dashboard routes redirect unauthenticated users to `/login`

## CI Pipeline

`.github/workflows/ci.yml`:

| Job | Description |
|-----|------------|
| `lint` | ESLint check |
| `unit` | Vitest unit tests (jsdom) |
| `integration` | Postgres container + Prisma migrate + integration tests |
| `build` | `prisma generate && next build` |
| `e2e` | Playwright against production build (depends on build) |

## Environment Files

- `.env.example` -- documented reference for all env vars
- `.env.test.example` -- minimal config for local integration testing
- `.env.local` -- local development (gitignored)
- `.env.test` -- integration test overrides (gitignored)

## Writing New Tests

### Unit Test

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

describe('myFunction', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-19T00:00:00Z'))
  })

  afterAll(() => {
    vi.useRealTimers()
  })

  it('does something', () => {
    expect(myFunction()).toBe(expected)
  })
})
```

### Integration Test

```typescript
import { PrismaClient } from '@prisma/client'
import { requireTestDatabase } from './setup'

requireTestDatabase()

describe('feature', () => {
  let prisma: PrismaClient
  beforeAll(async () => { prisma = new PrismaClient() })
  afterAll(async () => { await prisma.$disconnect() })
  // Use prisma directly against test DB
})
```
