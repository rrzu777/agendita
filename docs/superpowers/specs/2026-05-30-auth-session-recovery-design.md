# Spec: Auth Session Recovery & Middleware Fix

## Problem

Users with valid Supabase sessions get redirected back to `/login` when accessing `/dashboard`. This happens because `DashboardPage` checks `!userData?.business` and redirects to `/login`, creating a login → dashboard → login loop.

Additionally, the middleware intercepts ANY `?code=` query parameter on ANY route and forces redirect to `/reset-password`, breaking Supabase email confirmation and magic link flows.

## Root Causes

1. **DashboardLayout** only checks `!userData.user` but not business existence
2. **DashboardPage** redirects to `/login` when business is null (wrong destination)
3. **Middleware** catches all `?code=` params globally, always redirecting to `/reset-password`

## Architecture

```
DashboardLayout (/dashboard/*)
├─ getCurrentUser() → null → redirect('/login')
├─ user + business null → redirect('/recover-business')
└─ user + business → render children

/recover-business (independent route, no dashboard sidebar)
├─ no user → redirect('/login')
├─ user + business exists → redirect('/dashboard')
└─ user + no business → recovery UI
     → POST recoverBusiness()
     → creates Business + BusinessUser + Subscription + AvailabilityRule
     → redirect('/dashboard/onboarding')

Middleware
├─ Only intercepts /auth/callback?code=...
├─ Respects ?next= query param
└─ Does NOT touch ?code= on other routes
```

## Changes

### 1. DashboardLayout (`src/app/dashboard/layout.tsx`)

- After checking `!userData.user`, also check `!userData.business`
- If user exists but business is null → `redirect('/recover-business')`
- Keep existing sidebar rendering for valid users with business

### 2. New route: `/recover-business` (`src/app/recover-business/page.tsx`)

**Client component** (`'use client'`) with server action:
- Shows recovery UI with message "Parece que tu cuenta no tiene un negocio asociado"
- Button "Recuperar mi negocio" triggers `recoverBusiness()` server action
- Loading state during creation
- Error state with retry option
- Auto-redirect to `/dashboard` if business already exists

**Server action `recoverBusiness()`:**
1. `getCurrentUser()` → if null, return error
2. Find User in Prisma by `user.id`
3. If not found → find by `user.email` → if not found → create User
4. Check if BusinessUser already exists → if yes, return `{ alreadyExists: true }`
5. Verify "Beta gratis" plan exists → if not, return error for admin
6. Create Business + BusinessUser(owner) + BusinessSubscription + AvailabilityRule
7. Return success

**Logging (temporary, server-side):** Remove after verifying recovery works in production.
- `supabaseUserId`, `supabaseEmail`
- `prismaUserExists: true/false`
- `businessUserExists: true/false`
- `businessCreated: true/false`

### 3. Middleware fix (`src/middleware.ts`)

Replace global `?code=` interception with route-specific:

```ts
if (pathname === '/auth/callback') {
  const code = request.nextUrl.searchParams.get('code')
  if (code) {
    const next = request.nextUrl.searchParams.get('next') || '/dashboard'
    const response = NextResponse.redirect(new URL(next, request.url))
    const supabase = createMiddlewareAuthClient(request, response)
    await supabase.auth.exchangeCodeForSession(code)
    return response
  }
}
```

- Only acts on `/auth/callback`
- Respects `?next=` query param
- Defaults to `/dashboard` (not `/reset-password`)
- Other routes with `?code=` pass through untouched

### 4. Auth callback route (`src/app/auth/callback/route.ts`)

Can be simplified or removed since middleware now handles code exchange. Keep as fallback that respects `?next=`:

```ts
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const next = requestUrl.searchParams.get('next') || '/dashboard'
  return NextResponse.redirect(new URL(next, request.url))
}
```

### 5. Tests

| # | Scenario | Expected |
|---|----------|----------|
| 1 | No session → `/dashboard` | redirect `/login` |
| 2 | Session + BusinessUser → `/dashboard` | Dashboard renders |
| 3 | Session + no BusinessUser → `/dashboard` | redirect `/recover-business` |
| 4 | `/recover-business` POST | Creates business, redirect `/dashboard/onboarding` |
| 5 | `/recover-business` with existing business | redirect `/dashboard` |
| 6 | `/auth/callback?code=XXX&next=/reset-password` | Exchange code, redirect `/reset-password` |
| 7 | `/auth/callback?code=XXX` (no next) | Exchange code, redirect `/dashboard` |
| 8 | `/other?code=XXX` | No interception, passes through |

## Acceptance Criteria

- Login with valid account does NOT loop back to `/login` if session exists
- Missing BusinessUser shows recovery page or auto-creates business
- No login → dashboard → login loop
- Supabase email callbacks (confirmation, password reset) work correctly
- `?next=` param is respected in auth callbacks
