# C-email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email as a second channel to the existing marketing campaigns (today WhatsApp-only), reusing the same campaign/promo/grant model, deciding the channel per customer, and unify the marketing-email opt-out policy across campaigns and the loyalty cron.

**Architecture:** A shared `prepareCampaignSend` core (fetch recipient + opt-out gate + idempotent lazy grant mint + message render) backs two thin actions — `sendCampaignMessage` (WhatsApp, returns a `wa.me` URL) and `sendCampaignEmail` (sends server-side via Resend). Marketing emails (campaign promos + birthday/winback rewards) gain an unsubscribe footer and `List-Unsubscribe` headers pointing at a new public `/baja/[token]` page that reuses `setMarketingOptOutByToken` from #80. The opt-out gate moves out of the cron into `sendRewardEmail`, so there is a single marketing-email policy.

**Tech Stack:** Next.js (custom fork — `params` is a `Promise`, must `await`), Prisma 5.22, Resend, Vitest (unit + integration), React Server Components + client components.

**Worktree:** `.claude/worktrees/campaign-email`, branch `claude/campaign-email`. All `git` commands below assume you are inside that worktree (`git -C` not needed once your shell cwd is there, but prefer explicit `git add <files>`, never `git add -A`).

**Landmines to respect (from project memory):**
- `'use server'` modules (`src/server/actions/*.ts`) export ONLY async functions. Types/consts/pure helpers live in `src/lib/`.
- Component tests using `renderToStaticMarkup` MUST mock `next/navigation` (incl. `useRouter`) or they throw.
- `npm test` already implies `--run`. Run `npx tsc --noEmit 2>&1 | grep '^src/'` before the final commit — vitest/eslint do NOT typecheck.
- Integration tests need the local Docker test DB and run one file at a time:
  `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- <file>`
- No schema migration in this feature (deliberate — `sentAt` has no channel column, YAGNI).

---

## File Structure

**New files:**
- `src/lib/customers/email.ts` — `isEmailable(email)` predicate (pure).
- `src/lib/campaigns/send.ts` — `prepareCampaignSend()` shared core + `PreparedCampaignSend` type.
- `src/lib/notifications/marketing-email.ts` — pure unsubscribe URL/header/footer builders.
- `src/app/baja/[token]/page.tsx` — public unsubscribe page (reuses `MarketingOptOutSection`).
- `src/app/api/baja/[token]/route.ts` — `POST` one-click `List-Unsubscribe` handler.
- Tests: `tests/unit/customers-email.test.ts`, `tests/unit/marketing-email.test.ts`, `tests/unit/reward-email.test.ts`, `tests/integration/campaigns-email.test.ts`.

**Modified files:**
- `src/lib/campaigns/segments.ts` — `email` in select/type; contactability choke point.
- `src/lib/rate-limit.ts` — `send-campaign-email` bucket.
- `src/lib/notifications/email-provider.ts` — `headers` in `SendEmailOptions`; `sendCampaignPromoEmail` sender; reward unsubscribe wiring.
- `src/lib/notifications/templates.ts` — `campaignPromoHtml`/`campaignPromoText`; optional unsubscribe footer in `loyaltyRewardHtml`/`loyaltyRewardText`.
- `src/lib/notifications/types.ts` — `LoyaltyRewardEmailData.unsubscribeToken`.
- `src/lib/notifications/index.ts` — re-export `sendCampaignPromoEmail`, `campaignPromoHtml`, `campaignPromoText`.
- `src/lib/loyalty/reward-email.ts` — opt-out gate + unsubscribe token.
- `src/lib/cron/loyalty-automatic.ts` — remove `wantsRewardEmail`; pass `marketingOptOutAt`.
- `src/lib/loyalty/referral.ts` — add `marketingOptOutAt` to select.
- `src/server/actions/campaigns.ts` — refactor to `prepareCampaignSend`; add `sendCampaignEmail`; `email` in `getCampaignDetail`.
- `src/app/dashboard/campanas/[id]/page.tsx` — serialize `channel` + `email`.
- `src/app/dashboard/campanas/[id]/recipient-list.tsx` — email button per channel.
- `src/app/dashboard/campanas/page.tsx` + `campaign-list.tsx` — copy.
- Existing tests: `tests/unit/loyalty-automatic-cron.test.ts` (remove `wantsRewardEmail` describe), `tests/unit/recipient-list.test.tsx` (new fixture fields).

---

## Task 1: `isEmailable` predicate

**Files:**
- Create: `src/lib/customers/email.ts`
- Test: `tests/unit/customers-email.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/customers-email.test.ts
import { describe, expect, it } from 'vitest'
import { isEmailable } from '@/lib/customers/email'

describe('isEmailable', () => {
  it('accepts a normal email', () => {
    expect(isEmailable('ana@example.com')).toBe(true)
  })
  it('rejects null/empty', () => {
    expect(isEmailable(null)).toBe(false)
    expect(isEmailable(undefined)).toBe(false)
    expect(isEmailable('')).toBe(false)
    expect(isEmailable('   ')).toBe(false)
  })
  it('rejects strings without a domain dot after @', () => {
    expect(isEmailable('ana@example')).toBe(false)
    expect(isEmailable('ana.example.com')).toBe(false)
    expect(isEmailable('@example.com')).toBe(false)
    expect(isEmailable('ana@')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/customers-email.test.ts`
Expected: FAIL — `Cannot find module '@/lib/customers/email'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/customers/email.ts

/** Email utilizable para envío: no vacío y con forma mínima `algo@dominio.tld`.
 *  Validación laxa a propósito — el bounce real lo maneja Resend. Simétrico a
 *  isWhatsappablePhone en @/lib/customers/phone. */
export function isEmailable(email: string | null | undefined): boolean {
  if (!email) return false
  const trimmed = email.trim()
  const at = trimmed.indexOf('@')
  if (at <= 0) return false
  const domain = trimmed.slice(at + 1)
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/customers-email.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/customers/email.ts tests/unit/customers-email.test.ts
git commit -m "feat(campaigns): isEmailable predicate para contactabilidad por email"
```

---

## Task 2: Segments — email in select + contactability choke point

**Files:**
- Modify: `src/lib/campaigns/segments.ts`
- Test: `tests/integration/campaigns-segments.test.ts` (existing — add one case)

- [ ] **Step 1: Add a failing integration test case**

Open `tests/integration/campaigns-segments.test.ts`. Find the existing block that seeds customers for a segment (look for a `frequent` or `inactive` describe with completed bookings). Add this test inside the top-level `describe`, adapting the seed helpers already imported in that file (`prisma`, business/customer factories). The key assertion: an email-only customer (non-whatsappable phone, valid email) is now INCLUDED, and a customer with neither is EXCLUDED.

```ts
  it('incluye clienta email-only y excluye a la que no tiene ningún canal', async () => {
    // Segmento inactive: lastCompletedAt viejo. Reutiliza el businessId del setup.
    const oldDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)
    const emailOnly = await prisma.customer.create({
      data: {
        businessId, name: 'Email Only', phone: '1', email: 'emailonly@example.com',
        lastCompletedAt: oldDate,
      },
    })
    const noChannel = await prisma.customer.create({
      data: {
        businessId, name: 'No Channel', phone: '1', email: null,
        lastCompletedAt: oldDate,
      },
    })

    const rows = await queryCampaignSegment(
      prisma, businessId, 'inactive', {}, new Date(), 'America/Santiago',
    )
    const ids = rows.map((r) => r.id)
    expect(ids).toContain(emailOnly.id)
    expect(ids).not.toContain(noChannel.id)

    await prisma.customer.deleteMany({ where: { id: { in: [emailOnly.id, noChannel.id] } } })
  })
```

Note: `phone: '1'` has fewer than 8 digits → not whatsappable, so inclusion is driven purely by email.

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- tests/integration/campaigns-segments.test.ts`
Expected: FAIL — `emailOnly.id` is not in `ids` (current filter requires a whatsappable phone) AND `SegmentCustomer` has no `email`, so also a possible TS error at build. If the file fails to compile because `email` is referenced, that still counts as red.

- [ ] **Step 3: Add `email` to select/type and change the choke point**

In `src/lib/campaigns/segments.ts`:

Change the import line to add `isEmailable`:

```ts
import { isWhatsappablePhone } from '@/lib/customers/phone'
import { isEmailable } from '@/lib/customers/email'
```

Change the `SegmentCustomer` interface:

```ts
export interface SegmentCustomer {
  id: string; name: string; phone: string; email: string | null; birthDate: Date | null; marketingOptOutAt: Date | null
}
```

Change the `select` const:

```ts
const select = { id: true, name: true, phone: true, email: true, birthDate: true, marketingOptOutAt: true } as const
```

Change the choke point in `queryCampaignSegment`:

```ts
  const rows = await fetchSegmentRows(db, businessId, segment, params, now, timeZone)
  // Choke point de contactabilidad para TODO segmento (presente y futuro):
  // teléfono whatsappeable O email válido, y sin opt-out de marketing.
  return rows.filter((c) => (isWhatsappablePhone(c.phone) || isEmailable(c.email)) && !c.marketingOptOutAt)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- tests/integration/campaigns-segments.test.ts`
Expected: PASS (all cases including the new one).

- [ ] **Step 5: Commit**

```bash
git add src/lib/campaigns/segments.ts tests/integration/campaigns-segments.test.ts
git commit -m "feat(campaigns): segmentos contactan por whatsapp o email"
```

---

## Task 3: `headers` support in `sendEmail`

**Files:**
- Modify: `src/lib/notifications/email-provider.ts:97-133`

No new behavior test here (pure plumbing consumed by Task 4/5, which test it end-to-end). This is a mechanical extension.

- [ ] **Step 1: Extend `SendEmailOptions` and propagate headers**

In `src/lib/notifications/email-provider.ts`, change the `SendEmailOptions` type (currently lines ~97-99):

```ts
type SendEmailOptions = {
  replyTo?: string | null
  headers?: Record<string, string>
}
```

And in `sendEmail`, change the `resend.emails.send` call (currently lines ~126-133) to pass headers when present:

```ts
    const { data, error } = await resend.emails.send({
      from,
      to: [to],
      subject,
      html,
      text,
      ...(options?.replyTo ? { replyTo: options.replyTo } : {}),
      ...(options?.headers ? { headers: options.headers } : {}),
    })
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep '^src/lib/notifications/email-provider.ts' || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/notifications/email-provider.ts
git commit -m "feat(notifications): sendEmail acepta headers custom (para List-Unsubscribe)"
```

---

## Task 4: Marketing unsubscribe builders + campaign promo email

**Files:**
- Create: `src/lib/notifications/marketing-email.ts`
- Modify: `src/lib/notifications/templates.ts` (add `campaignPromoHtml`/`campaignPromoText`)
- Modify: `src/lib/notifications/email-provider.ts` (add `sendCampaignPromoEmail`)
- Modify: `src/lib/notifications/index.ts` (re-exports)
- Test: `tests/unit/marketing-email.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/marketing-email.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  marketingUnsubscribeUrl, unsubscribeHeaders, unsubscribeFooterHtml, unsubscribeFooterText,
} from '@/lib/notifications/marketing-email'
import { campaignPromoHtml, campaignPromoText } from '@/lib/notifications/templates'

describe('marketing-email builders', () => {
  const OLD = process.env.NEXT_PUBLIC_APP_DOMAIN
  beforeEach(() => { process.env.NEXT_PUBLIC_APP_DOMAIN = 'app.example.com' })
  afterEach(() => { process.env.NEXT_PUBLIC_APP_DOMAIN = OLD })

  it('builds the /baja page URL from the token', () => {
    expect(marketingUnsubscribeUrl('tok123')).toBe('https://app.example.com/baja/tok123')
  })

  it('emits one-click List-Unsubscribe headers pointing at the api route', () => {
    const h = unsubscribeHeaders('tok123')
    expect(h['List-Unsubscribe']).toBe('<https://app.example.com/api/baja/tok123>')
    expect(h['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })

  it('footer text/html contain the baja link', () => {
    expect(unsubscribeFooterText('tok123')).toContain('https://app.example.com/baja/tok123')
    expect(unsubscribeFooterHtml('tok123')).toContain('href="https://app.example.com/baja/tok123"')
  })
})

describe('campaignPromo templates', () => {
  it('html escapes the message, converts newlines, and appends the unsubscribe footer', () => {
    const html = campaignPromoHtml({
      businessName: 'Studio X',
      message: 'Hola <Ana>\nvení pronto',
      unsubscribeFooterHtml: '<p>UNSUB-MARKER</p>',
    })
    expect(html).toContain('Hola &lt;Ana&gt;')
    expect(html).toContain('<br>')
    expect(html).toContain('UNSUB-MARKER')
    expect(html).toContain('Studio X') // transactional footer still present
  })

  it('text joins message and footer', () => {
    const text = campaignPromoText('cuerpo del mensaje', 'baja: https://x/baja/t')
    expect(text).toContain('cuerpo del mensaje')
    expect(text).toContain('baja: https://x/baja/t')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/marketing-email.test.ts`
Expected: FAIL — `Cannot find module '@/lib/notifications/marketing-email'` and missing `campaignPromoHtml`/`campaignPromoText`.

- [ ] **Step 3: Create `marketing-email.ts`**

```ts
// src/lib/notifications/marketing-email.ts
import { getAppUrl } from '@/lib/business/urls'

/** URL de la página pública de baja (self-service, reusa setMarketingOptOutByToken). */
export function marketingUnsubscribeUrl(token: string): string {
  return getAppUrl(`/baja/${token}`)
}

/** URL del route handler POST para el one-click de List-Unsubscribe (RFC 8058). */
export function marketingUnsubscribeApiUrl(token: string): string {
  return getAppUrl(`/api/baja/${token}`)
}

/** Headers de baja: Gmail/Yahoo los exigen para bulk marketing y habilitan el
 *  botón "Cancelar suscripción" nativo del cliente de correo. */
export function unsubscribeHeaders(token: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${marketingUnsubscribeApiUrl(token)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

export function unsubscribeFooterHtml(token: string): string {
  const url = marketingUnsubscribeUrl(token)
  return `<p style="font-size:12px;color:#999;margin-top:8px">¿No quieres recibir promociones? <a href="${url}" style="color:#999">Darme de baja</a></p>`
}

export function unsubscribeFooterText(token: string): string {
  return `¿No quieres recibir promociones? Date de baja: ${marketingUnsubscribeUrl(token)}`
}
```

- [ ] **Step 4: Add `campaignPromoHtml`/`campaignPromoText` to `templates.ts`**

In `src/lib/notifications/templates.ts`, add these exported functions (they reuse the module-local `baseHtml`, `header`, `footer`, `escapeHtml` already defined near the top of the file — do NOT export those):

```ts
/** Cuerpo de email de campaña: el mensaje de la campaña (mismo texto que WhatsApp,
 *  placeholders ya sustituidos) envuelto en el layout estándar, con footer transaccional
 *  y el footer de baja de marketing (pasado ya renderizado por el caller). */
export function campaignPromoHtml(data: {
  businessName: string
  message: string
  unsubscribeFooterHtml: string
}): string {
  const body = escapeHtml(data.message).replace(/\n/g, '<br>')
  return baseHtml(`
    <p style="font-size:15px">${body}</p>
    ${footer(data.businessName)}
    ${data.unsubscribeFooterHtml}
  `)
}

export function campaignPromoText(message: string, unsubscribeFooterText: string): string {
  return `${message}\n\n${unsubscribeFooterText}`
}
```

- [ ] **Step 5: Add `sendCampaignPromoEmail` to `email-provider.ts`**

In `src/lib/notifications/email-provider.ts`, add the import near the other `./templates` / local imports:

```ts
import { unsubscribeHeaders, unsubscribeFooterHtml, unsubscribeFooterText } from './marketing-email'
```

Add `campaignPromoHtml, campaignPromoText` to the existing `from './templates'` import block.

Then add this exported sender (place it near `sendLoyaltyRewardNotification`):

```ts
/** Email de campaña de marketing (blast por email, canal alternativo a WhatsApp).
 *  Best-effort: degrada suave si falta provider/FROM. Lleva footer + headers de baja. */
export async function sendCampaignPromoEmail(args: {
  to: string
  businessName: string
  businessReplyToEmail: string | null
  message: string
  unsubscribeToken: string
}): Promise<EmailResult> {
  const subject = `${args.businessName} te dejó un beneficio 🎁`
  const html = campaignPromoHtml({
    businessName: args.businessName,
    message: args.message,
    unsubscribeFooterHtml: unsubscribeFooterHtml(args.unsubscribeToken),
  })
  const text = campaignPromoText(args.message, unsubscribeFooterText(args.unsubscribeToken))
  return sendEmail(args.to, subject, html, text, {
    replyTo: args.businessReplyToEmail,
    headers: unsubscribeHeaders(args.unsubscribeToken),
  })
}
```

- [ ] **Step 6: Re-export from `index.ts`**

In `src/lib/notifications/index.ts`, add `sendCampaignPromoEmail,` to the `from './email-provider'` export block, and `campaignPromoHtml,` + `campaignPromoText,` to the `from './templates'` export block.

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- tests/unit/marketing-email.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Commit**

```bash
git add src/lib/notifications/marketing-email.ts src/lib/notifications/templates.ts src/lib/notifications/email-provider.ts src/lib/notifications/index.ts tests/unit/marketing-email.test.ts
git commit -m "feat(notifications): builders de baja + sendCampaignPromoEmail"
```

---

## Task 5: Opt-out gate + unsubscribe footer in reward emails

**Files:**
- Modify: `src/lib/notifications/types.ts:181-189`
- Modify: `src/lib/notifications/templates.ts` (`loyaltyRewardHtml`/`loyaltyRewardText`)
- Modify: `src/lib/notifications/email-provider.ts` (`sendLoyaltyRewardNotification`)
- Modify: `src/lib/loyalty/reward-email.ts`
- Test: `tests/unit/reward-email.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/reward-email.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const sendLoyaltyRewardNotification = vi.hoisted(() => vi.fn(async () => ({ success: true })))
vi.mock('@/lib/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notifications')>()
  return {
    ...actual,
    sendLoyaltyRewardNotification,
    getBusinessReplyToEmail: vi.fn(async () => null),
    // sendNotificationSafely calls the fn and returns its result — keep real behavior:
    sendNotificationSafely: async (_label: string, fn: () => Promise<unknown>) => fn(),
  }
})

// ensureLoyaltyToken hits the DB; stub the token module.
vi.mock('@/lib/loyalty/token', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/loyalty/token')>()
  return {
    ...actual,
    ensureLoyaltyToken: vi.fn(async () => 'tok-abc'),
    buildLoyaltyCardLink: vi.fn(async () => 'https://x/tarjeta/tok-abc'),
  }
})

import { sendRewardEmail } from '@/lib/loyalty/reward-email'

const baseCustomer = {
  id: 'c1', name: 'Ana', email: 'ana@example.com', loyaltyToken: 'tok-abc', marketingOptOutAt: null as Date | null,
}
const baseArgs = {
  businessId: 'b1', businessName: 'Studio', config: { isActive: true }, rewardLabel: '20% off',
}

describe('sendRewardEmail opt-out gate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('birthday con opt-out: NO envía', async () => {
    await sendRewardEmail({ ...baseArgs, customer: { ...baseCustomer, marketingOptOutAt: new Date() }, reason: 'birthday' })
    expect(sendLoyaltyRewardNotification).not.toHaveBeenCalled()
  })

  it('winback sin opt-out: envía con unsubscribeToken', async () => {
    await sendRewardEmail({ ...baseArgs, customer: baseCustomer, reason: 'winback' })
    expect(sendLoyaltyRewardNotification).toHaveBeenCalledTimes(1)
    expect(sendLoyaltyRewardNotification.mock.calls[0][0]).toMatchObject({ unsubscribeToken: 'tok-abc' })
  })

  it('referral con opt-out: envía igual y SIN unsubscribeToken (agradecimiento)', async () => {
    await sendRewardEmail({ ...baseArgs, customer: { ...baseCustomer, marketingOptOutAt: new Date() }, reason: 'referral' })
    expect(sendLoyaltyRewardNotification).toHaveBeenCalledTimes(1)
    expect(sendLoyaltyRewardNotification.mock.calls[0][0]).toMatchObject({ unsubscribeToken: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/reward-email.test.ts`
Expected: FAIL — `sendRewardEmail` does not gate on opt-out and does not pass `unsubscribeToken`.

- [ ] **Step 3: Add `unsubscribeToken` to `LoyaltyRewardEmailData`**

In `src/lib/notifications/types.ts`, extend the interface (lines ~181-189):

```ts
export interface LoyaltyRewardEmailData {
  businessName: string
  businessReplyToEmail?: string | null
  customerName: string
  customerEmail: string
  rewardLabel: string
  reason: 'birthday' | 'winback' | 'referral'
  loyaltyCardLink: string | null
  /** Token de baja: presente sólo para emails de marketing (birthday/winback). null = sin footer/headers de baja. */
  unsubscribeToken?: string | null
}
```

- [ ] **Step 4: Wire the footer into `loyaltyRewardHtml`/`loyaltyRewardText`**

In `src/lib/notifications/templates.ts`, add the import at the top (with the other imports):

```ts
import { unsubscribeFooterHtml, unsubscribeFooterText } from './marketing-email'
```

Change `loyaltyRewardHtml` to append the unsubscribe footer when a token is present. Replace the current `return baseHtml(...)` body of `loyaltyRewardHtml` with:

```ts
  const unsub = data.unsubscribeToken ? unsubscribeFooterHtml(data.unsubscribeToken) : ''
  return baseHtml(`
    ${header(title)}
    <p style="font-size:15px">${escapeHtml(intro)}</p>
    <p style="font-size:16px;margin-top:16px">Te regalamos <strong>${escapeHtml(data.rewardLabel)}</strong>.</p>
    ${cta}
    ${footer(data.businessName)}
    ${unsub}
  `)
```

And in `loyaltyRewardText`, append the text footer when the token is present. Find the `return` of `loyaltyRewardText` and add before it:

```ts
  const unsub = data.unsubscribeToken ? `\n\n${unsubscribeFooterText(data.unsubscribeToken)}` : ''
```

then append `${unsub}` to the returned string (at the end of the text body).

- [ ] **Step 5: Pass headers in `sendLoyaltyRewardNotification`**

In `src/lib/notifications/email-provider.ts`, add `unsubscribeHeaders` to the existing `from './marketing-email'` import (added in Task 4). Change `sendLoyaltyRewardNotification` (currently lines ~503-518) so the `sendEmail` call includes headers when a token is present:

```ts
export async function sendLoyaltyRewardNotification(data: LoyaltyRewardEmailData): Promise<EmailResult> {
  if (!data.customerEmail) {
    return { success: false, skipped: 'Cliente sin email' }
  }

  const html = loyaltyRewardHtml(data)
  const text = loyaltyRewardText(data)

  return sendEmail(
    data.customerEmail,
    `${LOYALTY_REWARD_SUBJECTS[data.reason]} — ${data.businessName}`,
    html,
    text,
    {
      replyTo: data.businessReplyToEmail,
      ...(data.unsubscribeToken ? { headers: unsubscribeHeaders(data.unsubscribeToken) } : {}),
    },
  )
}
```

- [ ] **Step 6: Add the gate to `sendRewardEmail`**

Replace `src/lib/loyalty/reward-email.ts` entirely with:

```ts
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { buildLoyaltyCardLink, ensureLoyaltyToken } from './token'
import { getAppUrl } from '@/lib/business/urls'
import { getBusinessReplyToEmail, sendNotificationSafely, sendLoyaltyRewardNotification } from '@/lib/notifications'

/** Envía (best-effort, post-commit) el email de recompensa automática a una clienta.
 *  birthday/winback son marketing: respetan opt-out y llevan footer/headers de baja.
 *  referral es agradecimiento (cuasi-transaccional): se envía siempre, sin footer de baja.
 *  Nunca rompe ni bloquea la emisión: cualquier fallo se loguea y se traga. */
export async function sendRewardEmail(args: {
  businessId: string
  customer: { id: string; name: string; email: string; loyaltyToken: string | null; marketingOptOutAt: Date | null }
  businessName: string
  config: { isActive: boolean } | null | undefined
  rewardLabel: string
  reason: 'birthday' | 'winback' | 'referral'
}): Promise<void> {
  const { businessId, customer, businessName, config, rewardLabel, reason } = args
  const isMarketing = reason === 'birthday' || reason === 'winback'

  // Puerta única de opt-out para email de marketing (antes vivía en el cron).
  if (isMarketing && customer.marketingOptOutAt) {
    logger.info('loyalty.reward_email.opted_out', `email de marketing omitido por opt-out customer=${customer.id} reason=${reason}`)
    return
  }

  try {
    const loyaltyCardLink = await buildLoyaltyCardLink(prisma, customer, config, getAppUrl(''))
    // Los emails de marketing necesitan token de baja garantizado (mint lazy).
    const unsubscribeToken = isMarketing ? await ensureLoyaltyToken(prisma, customer) : null
    await sendNotificationSafely('loyalty_reward', async () =>
      sendLoyaltyRewardNotification({
        businessName,
        businessReplyToEmail: await getBusinessReplyToEmail(businessId),
        customerName: customer.name,
        customerEmail: customer.email,
        rewardLabel,
        reason,
        loyaltyCardLink: loyaltyCardLink ?? null,
        unsubscribeToken,
      }))
  } catch (e) {
    logger.error('loyalty.reward_email_failed', `reward email falló customer=${customer.id}: ${String(e)}`)
  }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- tests/unit/reward-email.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add src/lib/notifications/types.ts src/lib/notifications/templates.ts src/lib/notifications/email-provider.ts src/lib/loyalty/reward-email.ts tests/unit/reward-email.test.ts
git commit -m "feat(loyalty): puerta de opt-out + footer de baja en emails de recompensa"
```

---

## Task 6: Reconcile the cron and referral callers

**Files:**
- Modify: `src/lib/cron/loyalty-automatic.ts` (remove `wantsRewardEmail`, pass `marketingOptOutAt`)
- Modify: `src/lib/loyalty/referral.ts:114-131` (add `marketingOptOutAt` to select)
- Test: `tests/unit/loyalty-automatic-cron.test.ts` (remove the `wantsRewardEmail` describe)

- [ ] **Step 1: Update the cron test to reflect the moved gate**

Open `tests/unit/loyalty-automatic-cron.test.ts`. Remove the entire `describe('wantsRewardEmail', ...)` block and any `import { wantsRewardEmail } ...`. Leave the other describes (`selectTimedRuleForCustomer`, etc.) intact.

- [ ] **Step 2: Run the cron test to verify it fails**

Run: `npm test -- tests/unit/loyalty-automatic-cron.test.ts`
Expected: FAIL — the file still imports/uses `wantsRewardEmail` if you missed a reference, OR passes if the import was cleanly removed. If it passes here, that's fine — proceed; the real red is the build (Step 4) once `wantsRewardEmail` is deleted from the source but still referenced.

- [ ] **Step 3: Remove `wantsRewardEmail` and pass `marketingOptOutAt` in the cron**

In `src/lib/cron/loyalty-automatic.ts`:

Delete the entire `wantsRewardEmail` function (the exported `export function wantsRewardEmail(...) { ... }` block and its doc comment).

Change the email-sending block inside the `for (const c of customers)` loop. Replace:

```ts
          const kind = conditionKind(rule.conditions)
          if (wantsRewardEmail(kind, c)) {
            const rewardLabel = describeReward(
              out, rule, biz.loyaltyConfig?.pointsLabel ?? 'puntos', biz.currency || 'CLP',
            )
            if (rewardLabel && c.email) {
              await sendRewardEmail({
                businessId: biz.id,
                customer: { id: c.id, name: c.name, email: c.email, loyaltyToken: c.loyaltyToken },
                businessName: biz.name,
                config: biz.loyaltyConfig,
                rewardLabel,
                reason: kind,
              })
            }
          }
```

with:

```ts
          // Email de recompensa — sólo birthday/winback (anniversary queda mudo). La puerta
          // de opt-out vive ahora en sendRewardEmail; el grant se emitió igual (arriba).
          const kind = conditionKind(rule.conditions)
          if ((kind === 'birthday' || kind === 'winback') && c.email) {
            const rewardLabel = describeReward(
              out, rule, biz.loyaltyConfig?.pointsLabel ?? 'puntos', biz.currency || 'CLP',
            )
            if (rewardLabel) {
              await sendRewardEmail({
                businessId: biz.id,
                customer: {
                  id: c.id, name: c.name, email: c.email,
                  loyaltyToken: c.loyaltyToken, marketingOptOutAt: c.marketingOptOutAt,
                },
                businessName: biz.name,
                config: biz.loyaltyConfig,
                rewardLabel,
                reason: kind,
              })
            }
          }
```

Note: the cron's `customers` select already includes `marketingOptOutAt` (verified in current source), so no select change is needed here.

- [ ] **Step 4: Add `marketingOptOutAt` to the referral select**

In `src/lib/loyalty/referral.ts`, change the customer select in `notifyReferralReward` (currently ~lines 114-118):

```ts
  const customers = await prisma.customer.findMany({
    where: { id: { in: ids }, businessId },
    select: { id: true, name: true, email: true, loyaltyToken: true, marketingOptOutAt: true },
  })
```

The `sendRewardEmail` call in that loop passes the customer object; update it to include `marketingOptOutAt`:

```ts
    await sendRewardEmail({
      businessId,
      customer: {
        id: c.id, name: c.name, email: c.email,
        loyaltyToken: c.loyaltyToken, marketingOptOutAt: c.marketingOptOutAt,
      },
      businessName: biz.name,
      config: biz.loyaltyConfig,
      rewardLabel: label,
      reason: 'referral',
    })
```

- [ ] **Step 5: Verify build + cron test pass**

Run: `npx tsc --noEmit 2>&1 | grep '^src/' || echo "clean"`
Expected: `clean`.
Run: `npm test -- tests/unit/loyalty-automatic-cron.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cron/loyalty-automatic.ts src/lib/loyalty/referral.ts tests/unit/loyalty-automatic-cron.test.ts
git commit -m "refactor(loyalty): puerta de opt-out unificada en sendRewardEmail (cron + referral)"
```

---

## Task 7: `prepareCampaignSend` core + `sendCampaignEmail` action + rate bucket

**Files:**
- Create: `src/lib/campaigns/send.ts`
- Modify: `src/lib/rate-limit.ts:50-51`
- Modify: `src/server/actions/campaigns.ts` (refactor `sendCampaignMessage`, add `sendCampaignEmail`)
- Test: `tests/integration/campaigns-email.test.ts`

- [ ] **Step 1: Add the rate-limit bucket**

In `src/lib/rate-limit.ts`, add after the `'send-campaign'` line (~line 50):

```ts
  'send-campaign-email': { maxRequests: 30, windowMs: 60_000 },
```

- [ ] **Step 2: Create `prepareCampaignSend` in `src/lib/campaigns/send.ts`**

This extracts the fetch + opt-out gate + idempotent lazy mint + message render currently inline in `sendCampaignMessage`. It does NOT touch `sentAt` (each channel decides).

```ts
// src/lib/campaigns/send.ts
import type { Prisma, PrismaClient, PromotionGrant } from '@prisma/client'
import { formatInTimeZone } from 'date-fns-tz'
import { mintCampaignGrant } from './mint'
import { renderCampaignMessage } from './message'
import { isP2002 } from '@/lib/loyalty/credit'
import { ForbiddenError } from '@/lib/auth/server'

type Db = PrismaClient

export interface PreparedCampaignSend {
  recipient: {
    id: string
    sentAt: Date | null
    customer: {
      id: string; name: string; phone: string; email: string | null
      loyaltyToken: string | null; marketingOptOutAt: Date | null
    }
    campaign: {
      id: string; name: string
      business: { name: string; timezone: string | null }
    }
  }
  grant: PromotionGrant
  message: string
}

/** Núcleo compartido de envío de campaña (WhatsApp y email). Lee la destinataria,
 *  aplica la puerta 2 de opt-out (retroactiva), mintea el grant de forma perezosa e
 *  idempotente (por customerId+requestId) y renderiza el mensaje. NO marca sentAt:
 *  eso lo decide cada canal según su resultado. */
export async function prepareCampaignSend(
  db: Db,
  businessId: string,
  recipientId: string,
  createdByUserId: string,
): Promise<PreparedCampaignSend> {
  const [recipient, config] = await Promise.all([
    db.campaignRecipient.findFirst({
      where: { id: recipientId, campaign: { businessId } },
      select: {
        id: true, sentAt: true,
        customer: {
          select: {
            id: true, name: true, phone: true, email: true,
            loyaltyToken: true, marketingOptOutAt: true,
          },
        },
        campaign: {
          select: {
            id: true, name: true, messageTemplate: true,
            promotion: { select: { id: true, grantExpiryDays: true } },
            business: { select: { name: true, timezone: true } },
          },
        },
      },
    }),
    db.loyaltyConfig.findUnique({ where: { businessId }, select: { grantExpiryDays: true } }),
  ])
  if (!recipient) throw new ForbiddenError('Destinataria no encontrada')
  // Puerta 2 (retroactiva): la clienta pudo hacer opt-out DESPUÉS de materializar la lista.
  if (recipient.customer.marketingOptOutAt) {
    throw new Error('La clienta pidió no recibir campañas')
  }

  const tz = recipient.campaign.business.timezone || 'America/Santiago'
  const requestId = `campaign:${recipient.campaign.id}#${recipient.customer.id}`

  let grant: PromotionGrant | null = null
  try {
    grant = await db.$transaction((tx: Prisma.TransactionClient) =>
      mintCampaignGrant(tx, {
        businessId,
        promotion: {
          id: recipient.campaign.promotion.id,
          grantExpiryDays: recipient.campaign.promotion.grantExpiryDays,
        },
        customerId: recipient.customer.id,
        requestId,
        config: { grantExpiryDays: config?.grantExpiryDays ?? null },
        createdByUserId,
      }),
    )
  } catch (e) {
    if (isP2002(e)) {
      grant = await db.promotionGrant.findUnique({
        where: { customerId_requestId: { customerId: recipient.customer.id, requestId } },
      })
    }
    if (!grant) throw e
  }
  if (!grant) throw new Error('No se pudo generar el beneficio')

  const firstName = recipient.customer.name?.split(' ')[0] || ''
  const vencimiento = grant.expiresAt ? formatInTimeZone(grant.expiresAt, tz, 'dd/MM/yyyy') : 'sin vencimiento'
  const message = renderCampaignMessage(recipient.campaign.messageTemplate, {
    nombre: firstName, codigo: grant.code, vencimiento, negocio: recipient.campaign.business.name,
  })

  return { recipient, grant, message }
}
```

- [ ] **Step 3: Refactor `campaigns.ts` to use the core and add `sendCampaignEmail`**

In `src/server/actions/campaigns.ts`:

Update imports — add:

```ts
import { prepareCampaignSend } from '@/lib/campaigns/send'
import { isEmailable } from '@/lib/customers/email'
import { ensureLoyaltyToken } from '@/lib/loyalty/token'
import { getBusinessReplyToEmail, sendNotificationSafely, sendCampaignPromoEmail } from '@/lib/notifications'
```

Remove now-unused imports if the linter flags them after the refactor (`mintCampaignGrant`, `renderCampaignMessage`, `isP2002`, `formatInTimeZone`, `PromotionGrant` may become unused — remove only those that ESLint reports as unused; keep `isWhatsappablePhone`, `buildWhatsappUrl`).

Replace the entire body of `sendCampaignMessage` with:

```ts
export async function sendCampaignMessage(recipientId: string): Promise<{ waUrl: string | null }> {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('send-campaign', 120, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')

  const { recipient, grant, message } = await prepareCampaignSend(prisma, businessId, recipientId, user.id)

  await prisma.campaignRecipient.update({
    where: { id: recipient.id },
    data: { grantId: grant.id, sentAt: recipient.sentAt ?? new Date() },
  })

  const waUrl = isWhatsappablePhone(recipient.customer.phone)
    ? buildWhatsappUrl(recipient.customer.phone, message)
    : null
  return { waUrl }
}

/** Envío de campaña por email (canal alternativo a WhatsApp). Mintea el grant vía
 *  el mismo core idempotente, envía server-side vía Resend, y marca sentAt SÓLO si el
 *  envío fue exitoso (a diferencia de WhatsApp, acá conocemos el resultado). El grant
 *  minteado persiste aunque el email falle; reintentar es idempotente. */
export async function sendCampaignEmail(recipientId: string): Promise<{ sent: boolean; error?: string }> {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('send-campaign-email', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')

  const { recipient, grant, message } = await prepareCampaignSend(prisma, businessId, recipientId, user.id)

  const email = recipient.customer.email
  if (!isEmailable(email)) return { sent: false, error: 'La clienta no tiene un email válido.' }

  const token = await ensureLoyaltyToken(prisma, recipient.customer)
  const replyTo = await getBusinessReplyToEmail(businessId)
  const result = await sendNotificationSafely('campaign_email', () =>
    sendCampaignPromoEmail({
      to: email!,
      businessName: recipient.campaign.business.name,
      businessReplyToEmail: replyTo,
      message,
      unsubscribeToken: token,
    }))

  if (!result.success) {
    return { sent: false, error: result.error ?? result.skipped ?? 'No se pudo enviar el email' }
  }

  await prisma.campaignRecipient.update({
    where: { id: recipient.id },
    data: { grantId: grant.id, sentAt: recipient.sentAt ?? new Date() },
  })
  return { sent: true }
}
```

- [ ] **Step 4: Add `email` to `getCampaignDetail`**

In the same file, in `getCampaignDetail`, change the recipient customer select (currently `customer: { select: { name: true, phone: true, marketingOptOutAt: true } }`) to:

```ts
          customer: { select: { name: true, phone: true, email: true, marketingOptOutAt: true } },
```

- [ ] **Step 5: Write the integration test**

```ts
// tests/integration/campaigns-email.test.ts
import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest'

// Auth: forzamos owner de un negocio conocido.
const authState = vi.hoisted(() => ({ businessId: '', userId: '' }))
vi.mock('@/lib/auth/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/server')>()
  return {
    ...actual,
    requireBusinessRole: vi.fn(async () => ({
      businessId: authState.businessId,
      user: { id: authState.userId },
      business: { timezone: 'America/Santiago' },
    })),
  }
})

// Provider de email: capturamos y controlamos éxito/fallo.
const promoEmail = vi.hoisted(() => vi.fn(async () => ({ success: true, messageId: 'm1' })))
vi.mock('@/lib/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notifications')>()
  return {
    ...actual,
    sendCampaignPromoEmail: promoEmail,
    getBusinessReplyToEmail: vi.fn(async () => null),
    sendNotificationSafely: async (_l: string, fn: () => Promise<unknown>) => fn(),
  }
})

import { prisma } from '@/lib/db'
import { sendCampaignEmail } from '@/server/actions/campaigns'

// Helpers de seed: crea negocio + promo granted + campaña + recipient con email.
async function seed(opts: { optedOut?: boolean; email?: string | null }) {
  const business = await prisma.business.create({
    data: { name: 'Biz Email', slug: `biz-email-${Math.random().toString(36).slice(2)}`, timezone: 'America/Santiago' },
  })
  const user = await prisma.user.create({ data: { email: `u-${business.id}@x.com`, name: 'Owner' } })
  await prisma.businessUser.create({ data: { businessId: business.id, userId: user.id, role: 'owner' } })
  const promotion = await prisma.promotion.create({
    data: { businessId: business.id, triggerType: 'granted', pointsCost: null, name: 'Promo', rewardType: 'percentage', rewardValue: 20, appliesToAll: true },
  })
  const customer = await prisma.customer.create({
    data: {
      businessId: business.id, name: 'Ana Mail', phone: '1',
      email: opts.email === undefined ? 'anamail@example.com' : opts.email,
      marketingOptOutAt: opts.optedOut ? new Date() : null,
    },
  })
  const campaign = await prisma.campaign.create({
    data: {
      businessId: business.id, name: 'C', segmentType: 'inactive', promotionId: promotion.id,
      messageTemplate: 'Hola {nombre}, código {codigo}',
      recipients: { create: [{ customerId: customer.id }] },
    },
    include: { recipients: true },
  })
  authState.businessId = business.id
  authState.userId = user.id
  return { business, customer, campaign, recipientId: campaign.recipients[0].id }
}

const created: string[] = []
afterAll(async () => {
  // Limpieza best-effort por negocio.
  for (const id of created) {
    await prisma.campaignRecipient.deleteMany({ where: { campaign: { businessId: id } } })
    await prisma.campaign.deleteMany({ where: { businessId: id } })
    await prisma.promotionGrant.deleteMany({ where: { businessId: id } })
    await prisma.promotion.deleteMany({ where: { businessId: id } })
    await prisma.customer.deleteMany({ where: { businessId: id } })
    await prisma.businessUser.deleteMany({ where: { businessId: id } })
    await prisma.business.deleteMany({ where: { id } })
  }
})

describe('sendCampaignEmail', () => {
  beforeEach(() => vi.clearAllMocks())

  it('éxito: envía email, mintea grant y marca sentAt', async () => {
    const { business, recipientId } = await seed({})
    created.push(business.id)
    const res = await sendCampaignEmail(recipientId)
    expect(res.sent).toBe(true)
    expect(promoEmail).toHaveBeenCalledTimes(1)
    const r = await prisma.campaignRecipient.findUnique({ where: { id: recipientId } })
    expect(r?.sentAt).not.toBeNull()
    expect(r?.grantId).not.toBeNull()
  })

  it('fallo de envío: NO marca sentAt (grant persiste)', async () => {
    promoEmail.mockResolvedValueOnce({ success: false, error: 'boom' })
    const { business, recipientId } = await seed({})
    created.push(business.id)
    const res = await sendCampaignEmail(recipientId)
    expect(res.sent).toBe(false)
    const r = await prisma.campaignRecipient.findUnique({ where: { id: recipientId } })
    expect(r?.sentAt).toBeNull()
    // el grant sí se minteó
    const grants = await prisma.promotionGrant.count({ where: { businessId: business.id } })
    expect(grants).toBe(1)
  })

  it('opt-out retroactivo: lanza y no envía', async () => {
    const { business, recipientId } = await seed({ optedOut: true })
    created.push(business.id)
    await expect(sendCampaignEmail(recipientId)).rejects.toThrow('no recibir campañas')
    expect(promoEmail).not.toHaveBeenCalled()
  })

  it('sin email válido: devuelve sent:false sin llamar al provider', async () => {
    const { business, recipientId } = await seed({ email: null })
    created.push(business.id)
    const res = await sendCampaignEmail(recipientId)
    expect(res.sent).toBe(false)
    expect(promoEmail).not.toHaveBeenCalled()
  })
})
```

Note: adapt `prisma.business.create` / `prisma.user.create` field names to the real schema if the test fails on a missing required column — check `prisma/schema.prisma` for `Business`/`User` required fields and add them to the seed (e.g. `subdomain`, `currency`). Keep the seed minimal but valid.

- [ ] **Step 6: Run the integration test**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- tests/integration/campaigns-email.test.ts`
Expected: PASS (4 tests). If a seed column is missing, fix per the note in Step 5 and re-run.

- [ ] **Step 7: Verify the WhatsApp path still works**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- tests/integration/campaigns-actions.test.ts`
Expected: PASS (the existing WhatsApp `sendCampaignMessage` tests, now backed by `prepareCampaignSend`).

- [ ] **Step 8: Commit**

```bash
git add src/lib/campaigns/send.ts src/lib/rate-limit.ts src/server/actions/campaigns.ts tests/integration/campaigns-email.test.ts
git commit -m "feat(campaigns): sendCampaignEmail sobre core compartido prepareCampaignSend"
```

---

## Task 8: Per-row channel in the campaign detail UI

**Files:**
- Modify: `src/app/dashboard/campanas/[id]/page.tsx:73-80`
- Modify: `src/app/dashboard/campanas/[id]/recipient-list.tsx`
- Test: `tests/unit/recipient-list.test.tsx` (existing — update fixtures + add a case)

- [ ] **Step 1: Update the recipient-list test**

Open `tests/unit/recipient-list.test.tsx`. Every `recipients` fixture object currently has fields `{ id, name, phone, sentAt, grantStatus, optedOut }`. Add `channel` and `email` to each. For the existing whatsappable fixtures use `channel: 'whatsapp', email: null`. Then add this new test at the end of the `describe`:

```ts
  it('canal email: muestra "Enviar email" y no el botón de WhatsApp', async () => {
    const { RecipientList } = await import('@/app/dashboard/campanas/[id]/recipient-list')

    const html = renderToStaticMarkup(
      <RecipientList
        recipients={[
          { id: 'r1', name: 'Mai Mail', phone: '1', email: 'mai@example.com', sentAt: null, grantStatus: null, optedOut: false, channel: 'email' },
        ]}
        metrics={{ enviadas: 0, canjearon: 0, vigentes: 0 }}
      />,
    )

    expect(html).toContain('Enviar email')
    expect(html).not.toContain('Enviar por WhatsApp')
  })
```

Also update the `optedOut: true` fixture from the existing opt-out test to add `channel: 'email'` (or `'whatsapp'`) and `email: null` so it type-checks.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/unit/recipient-list.test.tsx`
Expected: FAIL — `RecipientItem` has no `channel`/`email`, and there is no "Enviar email" button.

- [ ] **Step 3: Extend `RecipientItem` and add the email button**

In `src/app/dashboard/campanas/[id]/recipient-list.tsx`:

Change the imports at the top to add the email action and a mail icon:

```ts
import { Loader2, Mail, MessageCircle, Users } from 'lucide-react'
import { sendCampaignMessage, sendCampaignEmail } from '@/server/actions/campaigns'
```

Extend `RecipientItem`:

```ts
export interface RecipientItem {
  id: string
  name: string
  phone: string
  email: string | null
  sentAt: Date | null
  grantStatus: string | null
  optedOut: boolean
  channel: 'whatsapp' | 'email' | 'none'
}
```

Add an email-send handler alongside `handleSend` (the WhatsApp one). Place it right after `handleSend`:

```ts
  async function handleSendEmail(recipientId: string) {
    setSending((prev) => new Set(prev).add(recipientId))
    setError(null)
    try {
      const { sent, error: err } = await sendCampaignEmail(recipientId)
      if (!sent) setError({ recipientId, message: err ?? 'No se pudo enviar el email' })
      router.refresh()
    } catch (e) {
      setError({ recipientId, message: e instanceof Error ? e.message : 'No se pudo enviar' })
    } finally {
      setSending((prev) => {
        const next = new Set(prev)
        next.delete(recipientId)
        return next
      })
    }
  }
```

Replace the `sendButton` function so it branches on channel:

```ts
  function sendButton(r: RecipientItem) {
    if (r.optedOut || r.channel === 'none') {
      return <span className="text-sm text-muted-foreground">No contactar</span>
    }
    if (r.channel === 'email') {
      return (
        <div className="flex flex-col items-end gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleSendEmail(r.id)}
            disabled={sending.has(r.id)}
          >
            {sending.has(r.id) ? (
              <Loader2 className="mr-1 size-4 animate-spin" />
            ) : (
              <Mail className="mr-1 size-4" />
            )}
            {r.sentAt ? 'Reenviar email' : 'Enviar email'}
          </Button>
          {error?.recipientId === r.id && (
            <span className="text-xs text-destructive">{error.message}</span>
          )}
        </div>
      )
    }
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          size="sm"
          className="bg-[#25D366] text-white hover:bg-[#1ebe5b]"
          onClick={() => handleSend(r.id)}
          disabled={sending.has(r.id)}
        >
          {sending.has(r.id) ? (
            <Loader2 className="mr-1 size-4 animate-spin" />
          ) : (
            <MessageCircle className="mr-1 size-4" />
          )}
          {r.sentAt ? 'Reenviar' : 'Enviar por WhatsApp'}
        </Button>
        {error?.recipientId === r.id && (
          <span className="text-xs text-destructive">{error.message}</span>
        )}
      </div>
    )
  }
```

- [ ] **Step 4: Serialize `channel` + `email` in the page**

In `src/app/dashboard/campanas/[id]/page.tsx`, add the imports:

```ts
import { isWhatsappablePhone } from '@/lib/customers/phone'
import { isEmailable } from '@/lib/customers/email'
```

Replace the `recipients` map (currently lines ~73-80) with:

```ts
  const recipients = campaign.recipients.map((r) => {
    const channel: 'whatsapp' | 'email' | 'none' = isWhatsappablePhone(r.customer.phone)
      ? 'whatsapp'
      : isEmailable(r.customer.email)
        ? 'email'
        : 'none'
    return {
      id: r.id,
      name: r.customer.name,
      phone: r.customer.phone,
      email: r.customer.email,
      sentAt: r.sentAt,
      grantStatus: r.grant?.status ?? null,
      optedOut: r.customer.marketingOptOutAt != null,
      channel,
    }
  })
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/unit/recipient-list.test.tsx`
Expected: PASS (including the new email-channel case).

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/campanas/[id]/page.tsx src/app/dashboard/campanas/[id]/recipient-list.tsx tests/unit/recipient-list.test.tsx
git commit -m "feat(campaigns): botón de envío por email según canal de la fila"
```

---

## Task 9: Public unsubscribe page + one-click API route

**Files:**
- Create: `src/app/baja/[token]/page.tsx`
- Create: `src/app/api/baja/[token]/route.ts`

- [ ] **Step 1: Create the unsubscribe page**

Mirror `src/app/tarjeta/[token]/page.tsx`'s server-bound action pattern. `params` is a Promise (custom Next fork — must `await`).

```tsx
// src/app/baja/[token]/page.tsx
import type { Metadata } from 'next'
import { prisma } from '@/lib/db'
import { resolveLoyaltyCustomer } from '@/lib/loyalty/token'
import { setMarketingOptOutByToken } from '@/server/actions/marketing-optout'
import { MarketingOptOutSection } from '@/components/loyalty/marketing-optout-section'
import { PageMessage } from '@/components/ui/page-message'

export const metadata: Metadata = { robots: { index: false, follow: false } }

// El token es la credencial (mismo criterio que /tarjeta): va bindeado server-side.
async function optOutAction(token: string, optedOut: boolean) {
  'use server'
  await setMarketingOptOutByToken(token, optedOut)
}

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const customer = await resolveLoyaltyCustomer(prisma, token)

  if (!customer) {
    return <PageMessage title="Enlace no disponible" message="El enlace no es válido o ya no está activo." />
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-center font-heading text-xl font-semibold text-primary">
        Promociones de {customer.business.name}
      </h1>
      <MarketingOptOutSection
        businessName={customer.business.name}
        optedOut={customer.marketingOptOutAt != null}
        action={optOutAction.bind(null, token)}
      />
    </main>
  )
}
```

- [ ] **Step 2: Create the one-click POST route**

`List-Unsubscribe-Post` clients POST to this URL without opening the page. It must succeed idempotently.

```ts
// src/app/api/baja/[token]/route.ts
import { NextResponse } from 'next/server'
import { setMarketingOptOutByToken } from '@/server/actions/marketing-optout'
import { ForbiddenError } from '@/lib/auth/server'
import { logger } from '@/lib/logger'

// One-click List-Unsubscribe (RFC 8058). El cliente de correo hace POST sin abrir
// la página. setMarketingOptOutByToken ya aplica rate limit ('optout-public') y
// resuelve el token; token inválido → 404.
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    await setMarketingOptOutByToken(token, true)
    return new NextResponse(null, { status: 200 })
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return new NextResponse(null, { status: 404 })
    }
    logger.error('marketing.unsubscribe_oneclick_failed', `baja one-click falló: ${String(e)}`)
    return new NextResponse(null, { status: 500 })
  }
}
```

- [ ] **Step 3: Manual smoke via build/typecheck (no route test framework here)**

Run: `npx tsc --noEmit 2>&1 | grep '^src/app/baja' || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Verify the page renders (dev server)**

Run the dev server and hit a real token. Get a token:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npx tsx -e "import {prisma} from './src/lib/db'; prisma.customer.findFirst({where:{loyaltyToken:{not:null}},select:{loyaltyToken:true}}).then(c=>{console.log(c?.loyaltyToken); process.exit(0)})"
```

If a token exists, start dev and open `http://localhost:3000/baja/<token>` to confirm the section renders and toggling works. (If no token exists in the test DB, this is optional — the typecheck + reused `MarketingOptOutSection` already exercise the wiring; note it as skipped.)

- [ ] **Step 5: Commit**

```bash
git add src/app/baja/[token]/page.tsx src/app/api/baja/[token]/route.ts
git commit -m "feat(marketing): página pública /baja/[token] + one-click List-Unsubscribe"
```

---

## Task 10: Copy — campaigns are WhatsApp OR email

**Files:**
- Modify: `src/app/dashboard/campanas/page.tsx:45`
- Modify: `src/app/dashboard/campanas/campaign-list.tsx:34`

- [ ] **Step 1: Update the subtitle**

In `src/app/dashboard/campanas/page.tsx`, change the subtitle string (currently `"Enviá promos por WhatsApp a un grupo de clientas."`) to:

```tsx
        subtitle="Enviá promos por WhatsApp o email a un grupo de clientas."
```

(Match the exact prop/quote style already present on that line.)

- [ ] **Step 2: Update the empty-state copy**

In `src/app/dashboard/campanas/campaign-list.tsx`, find the string containing `"enviar promos por WhatsApp"` (~line 34) and change it to `"enviar promos por WhatsApp o email"`, preserving the surrounding sentence.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep '^src/app/dashboard/campanas' || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/campanas/page.tsx src/app/dashboard/campanas/campaign-list.tsx
git commit -m "chore(campaigns): copy — campañas por WhatsApp o email"
```

---

## Final verification (after all tasks)

- [ ] **Full unit suite**

Run: `npm test`
Expected: all green (includes new `customers-email`, `marketing-email`, `reward-email`, updated `recipient-list`, `loyalty-automatic-cron`).

- [ ] **Integration suites touched**

Run each once (one file at a time):
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- tests/integration/campaigns-email.test.ts
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- tests/integration/campaigns-segments.test.ts
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- tests/integration/campaigns-actions.test.ts
```
Expected: all green.

- [ ] **Typecheck the whole app** (vitest/eslint do not typecheck)

Run: `npx tsc --noEmit 2>&1 | grep '^src/' || echo "clean"`
Expected: `clean`.

- [ ] **Lint**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Then:** run `/simplify` over `main...HEAD`, address findings, and open the PR (needs explicit user OK to merge, per project workflow).
