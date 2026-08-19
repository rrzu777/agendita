# Settings Information Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el formulario monolítico de Configuración por cuatro secciones enlazables, guardado parcial seguro, protección de cambios pendientes y una presentación responsive coherente.

**Architecture:** Tres formularios cliente independientes consumen schemas y Server Actions section-scoped que sólo escriben sus propias columnas. Un layout anidado de Next.js aporta header y navegación local; un provider ligero en el layout general del dashboard protege la navegación cuando el formulario visible está dirty y un borrador versionado en `sessionStorage` cubre Back/Forward sin manipular el historial.

**Tech Stack:** Next.js 16.2.6 App Router, React 19, TypeScript, React Hook Form, Zod 4, Prisma 5, Radix Dialog, Tailwind CSS 4, Vitest 4 y Playwright 1.59.

**Spec:** `docs/superpowers/specs/2026-08-18-settings-information-architecture-design.md`

## Global Constraints

- No cambiar reglas de reservas, cancelación, abonos, Web Push ni proveedores de pago.
- No agregar migraciones, dependencias, autosave server-side ni uploader de imágenes.
- Cada página, lectura y acción sensible debe exigir `owner` o `admin`; el layout no es la frontera de seguridad.
- Ninguna acción acepta `businessId` del cliente y cada update Prisma enumera sólo las columnas de su sección.
- Reutilizar paleta, tipografía, radios y componentes actuales; no convertir la página en una cuadrícula de cards decorativas.
- Pagos no se consulta ni se prefetch desde otras secciones.
- Leer antes de tocar rutas: `node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md`, `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md` y `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md` (usar los paths equivalentes presentes en la instalación si cambia el índice).
- Cada tarea sigue RED → GREEN, termina en commit y recibe revisión independiente antes de continuar.

## File Map

- `src/lib/business/schema.ts`: validators y tipos de Perfil, Reservas y Políticas.
- `src/server/actions/business-settings.ts`: tres mutaciones section-scoped y normalización de sus respuestas.
- `src/components/dashboard/unsaved-changes-provider.tsx`: registro dirty, diálogo y navegación protegida.
- `src/lib/business/settings-draft.ts`: envelope y comparación pura de borradores.
- `src/components/dashboard/settings/use-settings-draft.ts`: persistencia/recuperación cliente de borradores.
- `src/lib/business/settings-navigation.ts`: única fuente de rutas, labels y política de prefetch.
- `src/components/dashboard/settings/settings-{shell,navigation,save-bar,form-section}.tsx`: estructura visual compartida.
- `src/components/dashboard/settings/{profile,reservation,policy}-settings-form.tsx`: un formulario por dominio.
- `src/components/dashboard/settings/public-profile-preview.tsx`: preview aislada.
- `src/app/dashboard/settings/{layout,page,profile/page,reservations/page,policies/page}.tsx`: rutas y selección mínima de props.
- `src/app/dashboard/settings/payments/page.tsx`: contenido existente integrado al shell y autorización uniforme.
- `tests/unit/settings-*.test.ts(x)`: contratos de acciones, shell, dirty guard, drafts y formularios.
- `tests/e2e/settings.spec.ts`: navegación, responsive, guardado y descarte.

---

### Task 1: Section-scoped schemas and Server Actions

**Files:**
- Modify: `src/lib/business/schema.ts`
- Modify: `src/server/actions/business-settings.ts`
- Modify: `tests/unit/business-settings-schema.test.ts`
- Modify: `tests/unit/business-settings-action.test.ts`
- Create: `tests/integration/business-settings-sections.test.ts`

**Interfaces:**
- Produces: `profileSettingsSchema`, `reservationSettingsSchema`, `policySettingsSchema`.
- Produces: `ProfileSettingsInput`, `ReservationSettingsInput`, `PolicySettingsInput`.
- Produces: `updateProfileSettings(input)`, `updateReservationSettings(input)`, `updatePolicySettings(input)`, each returning `ActionResult` with complete form-shaped normalized values.
- Preserves temporarily: `updateBusinessSchema` and `updateBusinessSettings` until Task 8 removes the monolith.

- [ ] **Step 1: Write failing schema tests for the exact section boundaries**

```ts
it('profile schema owns only public identity fields', () => {
  const parsed = profileSettingsSchema.parse({
    name: ' Mi Negocio ', bio: '', profileImageUrl: '', logoUrl: '',
    whatsapp: '', instagram: '', addressText: '', city: ' Santiago ',
    subdomain: 'Mi-Negocio',
  })
  expect(parsed).toMatchObject({ name: 'Mi Negocio', city: 'Santiago', subdomain: 'mi-negocio' })
  expect('timezone' in parsed).toBe(false)
})

it('reservation schema keeps the empty cutoff out of its contract', () => {
  const parsed = reservationSettingsSchema.parse({
    timezone: 'America/Santiago', slotStepMinutes: 'service', manualHoldHours: '24',
    requireBookingApproval: false, defaultMeetingUrl: '',
  })
  expect(parsed.slotStepMinutes).toBe('service')
  expect('selfServiceCutoffHours' in parsed).toBe(false)
})

it('policy schema keeps cutoff and reminder together', () => {
  const parsed = policySettingsSchema.parse({
    selfServiceCutoffHours: '24', cancellationReminderEnabled: true,
    cancellationPolicy: '', bookingPolicy: '', depositPolicy: '',
  })
  expect(parsed.selfServiceCutoffHours).toBe(24)
})
```

- [ ] **Step 2: Run schema tests and verify RED**

Run: `npm test -- tests/unit/business-settings-schema.test.ts`

Expected: FAIL because the three section schemas are not exported.

- [ ] **Step 3: Define schemas by reusing the current validators without changing semantics**

```ts
const nameField = z.string().max(100).transform(v => v.trim()).refine(v => v.length > 0, 'El nombre es obligatorio')
const bioField = z.string().max(500).optional()
const optionalUrlField = z.string().url('URL inválida').optional().or(z.literal(''))
const optionalStringField = z.string().optional().or(z.literal(''))
const cityField = z.string().transform(v => v.trim()).refine(v => v.length > 0, 'La ciudad es obligatoria')
const subdomainField = z.string().min(3, 'Mínimo 3 caracteres').max(30, 'Máximo 30 caracteres')
  .regex(/^[a-zA-Z0-9-]+$/, 'Solo letras, números y guiones').transform(v => v.toLowerCase())
const timezoneField = z.string().default('America/Santiago')
const slotStepField = z.enum(['15', '30', '45', '60', 'service']).default('30')
const cutoffField = z.preprocess(
  v => v === '' || v == null ? undefined : v,
  z.coerce.number().int().min(0).max(720).default(24),
)
const manualHoldField = z.preprocess(
  v => v === '' || v == null ? undefined : v,
  z.coerce.number().int().min(1).max(720).default(24),
)
const meetingUrlField = z.string().trim().url('Tiene que ser un link completo, con https://')
  .refine(v => /^https?:\/\//i.test(v), 'Tiene que empezar con https://')
  .refine(v => !/[\u0000-\u001F\u007F]/.test(v), 'El link no puede tener saltos de línea')
  .max(500, 'El link es demasiado largo').optional().or(z.literal(''))

export const profileSettingsSchema = z.object({
  name: nameField,
  bio: bioField,
  profileImageUrl: optionalUrlField,
  logoUrl: optionalUrlField,
  whatsapp: optionalStringField,
  instagram: optionalStringField,
  addressText: optionalStringField,
  city: cityField,
  subdomain: subdomainField,
})

export const reservationSettingsSchema = z.object({
  timezone: timezoneField,
  slotStepMinutes: slotStepField,
  manualHoldHours: manualHoldField,
  requireBookingApproval: z.boolean().default(false),
  defaultMeetingUrl: meetingUrlField,
})

export const policySettingsSchema = z.object({
  selfServiceCutoffHours: cutoffField,
  cancellationReminderEnabled: z.boolean().default(true),
  cancellationPolicy: optionalStringField,
  bookingPolicy: optionalStringField,
  depositPolicy: optionalStringField,
})

export type ProfileSettingsInput = z.input<typeof profileSettingsSchema>
export type ReservationSettingsInput = z.input<typeof reservationSettingsSchema>
export type PolicySettingsInput = z.input<typeof policySettingsSchema>
```

Extract the current validators into module-local constants first; do not relax URL, integer, default or trim rules. Compose the temporary `updateBusinessSchema` from the three schemas so existing callers stay green during migration.

- [ ] **Step 4: Run schema tests and verify GREEN**

Run: `npm test -- tests/unit/business-settings-schema.test.ts`

Expected: all schema tests PASS.

- [ ] **Step 5: Write failing action tests proving column isolation and normalized responses**

```ts
const profileInput: ProfileSettingsInput = {
  name: 'Mi Negocio', bio: '', profileImageUrl: '', logoUrl: '',
  whatsapp: '9 1234 5678', instagram: '@minegocio', addressText: '',
  city: 'Santiago', subdomain: 'mi-negocio',
}
const reservationInput: ReservationSettingsInput = {
  timezone: 'America/Santiago', slotStepMinutes: 'service', manualHoldHours: 24,
  requireBookingApproval: false, defaultMeetingUrl: '',
}
const policyInput: PolicySettingsInput = {
  selfServiceCutoffHours: 24, cancellationReminderEnabled: true,
  cancellationPolicy: '', bookingPolicy: '', depositPolicy: '',
}

it('profile update never writes reservation or policy columns', async () => {
  mockPrisma.business.update.mockResolvedValue({
    name: 'Mi Negocio', bio: null, profileImageUrl: null, logoUrl: null,
    whatsapp: '+56912345678', instagram: 'minegocio', addressText: null,
    city: 'Santiago', subdomain: 'mi-negocio',
  })
  const result = await updateProfileSettings(profileInput)
  const call = mockPrisma.business.update.mock.calls[0][0]
  expect(call.where).toEqual({ id: 'biz-1' })
  expect(Object.keys(call.data).sort()).toEqual([
    'addressText', 'bio', 'city', 'instagram', 'logoUrl', 'name',
    'profileImageUrl', 'subdomain', 'whatsapp',
  ])
  expect(result).toMatchObject({ ok: true, data: { whatsapp: '+56912345678', bio: '' } })
})

it('reservation update writes only reservation fields', async () => {
  await updateReservationSettings(reservationInput)
  expect(mockPrisma.business.update.mock.calls[0][0].data).toEqual({
    timezone: 'America/Santiago', slotStepMinutes: null, manualHoldHours: 24,
    requireBookingApproval: false, defaultMeetingUrl: null,
  })
})

it('policy update writes only policy fields', async () => {
  await updatePolicySettings(policyInput)
  expect(mockPrisma.business.update.mock.calls[0][0].data).toEqual({
    selfServiceCutoffHours: 24, cancellationReminderEnabled: true,
    cancellationPolicy: null, bookingPolicy: null, depositPolicy: null,
  })
})
```

Also add one auth failure, one shared rate-limit failure and a malicious extra `businessId` case per public action. Keep reserved/duplicate subdomain cases on `updateProfileSettings` only.

In `tests/integration/business-settings-sections.test.ts`, use the real `PrismaClient`, `requireTestDatabase()` and these fixed tenant IDs. Mock only auth, rate limit and cache revalidation:

```ts
const BIZ = 'settings-sections-biz'
const USER = 'settings-sections-user'

vi.mock('@/lib/auth/server', () => ({
  requireBusinessRole: async () => ({ businessId: BIZ, user: { id: USER }, role: 'owner' }),
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ success: true }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/server/actions/revalidate-business', () => ({ revalidateBusinessPublicPaths: async () => {} }))

beforeAll(async () => {
  await prisma.user.create({ data: { id: USER, email: 'settings-sections@test.agendita.cl', name: 'Settings Owner' } })
  await prisma.business.create({ data: {
    id: BIZ, ownerUserId: USER, name: 'Original', slug: 'settings-sections', subdomain: 'settings-sections',
    city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90,
  } })
  await prisma.businessUser.create({ data: { id: 'settings-sections-bu', businessId: BIZ, userId: USER, role: 'owner' } })
})

it('concurrent section updates preserve both sets of columns', async () => {
  const { updateProfileSettings, updatePolicySettings } = await import('@/server/actions/business-settings')
  const [profile, policy] = await Promise.all([
    updateProfileSettings({
      name: 'Perfil nuevo', bio: '', profileImageUrl: '', logoUrl: '', whatsapp: '',
      instagram: '', addressText: '', city: 'Santiago', subdomain: 'settings-sections',
    }),
    updatePolicySettings({
      selfServiceCutoffHours: 24, cancellationReminderEnabled: true,
      cancellationPolicy: '', bookingPolicy: 'Política nueva', depositPolicy: '',
    }),
  ])
  expect(profile.ok).toBe(true)
  expect(policy.ok).toBe(true)
  const row = await prisma.business.findUniqueOrThrow({ where: { id: BIZ } })
  expect(row.name).toBe('Perfil nuevo')
  expect(row.bookingPolicy).toBe('Política nueva')
  expect(row.timezone).toBe('America/Santiago')
})
```

The file must delete `businessUser`, `business` and `user` in dependency order and disconnect Prisma in `afterAll`.

- [ ] **Step 6: Run action tests and verify RED**

Run: `npm test -- tests/unit/business-settings-action.test.ts`

Expected: FAIL because the three actions do not exist.

Run: `npm run test:integration -- tests/integration/business-settings-sections.test.ts`

Expected: FAIL because the section actions do not exist. `TEST_DATABASE_URL` must point to a disposable local PostgreSQL database accepted by `requireTestDatabase()`.

- [ ] **Step 7: Implement the minimal section actions**

```ts
async function enforceSettingsRateLimit() {
  const limit = await checkRateLimit('update-business-settings', 20, 60_000)
  if (!limit.success) throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
}

function parseSettings<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map(issue => issue.message).join(', '))
  }
  return parsed.data
}

async function _updateReservationSettings(data: ReservationSettingsInput) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  await enforceSettingsRateLimit()
  const v = parseSettings(reservationSettingsSchema, data)
  const updated = await prisma.business.update({
    where: { id: businessId },
    data: {
      timezone: v.timezone,
      slotStepMinutes: slotStepToMinutes(v.slotStepMinutes),
      manualHoldHours: v.manualHoldHours,
      requireBookingApproval: v.requireBookingApproval,
      defaultMeetingUrl: trimToNull(v.defaultMeetingUrl),
    },
    select: {
      timezone: true, slotStepMinutes: true, manualHoldHours: true,
      requireBookingApproval: true, defaultMeetingUrl: true,
    },
  })
  revalidatePath('/dashboard/settings/reservations')
  await revalidateBusinessPublicPaths(businessId)
  return {
    timezone: updated.timezone,
    slotStepMinutes: updated.slotStepMinutes == null ? 'service' : String(updated.slotStepMinutes),
    manualHoldHours: updated.manualHoldHours,
    requireBookingApproval: updated.requireBookingApproval,
    defaultMeetingUrl: updated.defaultMeetingUrl ?? '',
  } satisfies ReservationSettingsInput
}

export const updateReservationSettings = action(_updateReservationSettings)
```

Implement Perfil and Políticas with the same shape. `enforceSettingsRateLimit()` must use the existing key `update-business-settings` so splitting endpoints cannot multiply the 20/minute allowance. Return every field in the section, converting DB nulls back to empty strings.
Import `z` from `zod` in the server module only for the generic `parseSettings` helper; keep all exported schemas and types in the pure schema module because a `'use server'` file may export only async functions.

- [ ] **Step 8: Run focused tests and typecheck**

Run: `npm test -- tests/unit/business-settings-schema.test.ts tests/unit/business-settings-action.test.ts && npm run test:integration -- tests/integration/business-settings-sections.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add src/lib/business/schema.ts src/server/actions/business-settings.ts tests/unit/business-settings-schema.test.ts tests/unit/business-settings-action.test.ts tests/integration/business-settings-sections.test.ts
git commit -m "refactor: scope business settings updates"
```

Review checkpoint: confirm no partial action writes a column owned by another section and no user-controlled tenant ID enters Prisma.

---

### Task 2: Unsaved-change guard and recoverable local drafts

**Files:**
- Create: `src/lib/business/settings-draft.ts`
- Create: `src/components/dashboard/unsaved-changes-provider.tsx`
- Create: `src/components/dashboard/settings/use-settings-draft.ts`
- Modify: `src/app/dashboard/layout.tsx`
- Modify: `src/components/dashboard/sidebar.tsx`
- Create: `tests/unit/settings-draft.test.ts`
- Create: `tests/unit/unsaved-changes-provider.test.tsx`

**Interfaces:**
- Produces: `readSettingsDraft<T>(storage, key, version, currentBaseline)` returning `none | restored | conflict`.
- Produces: `writeSettingsDraft<T>()` and `clearSettingsDraft()`.
- Produces: `useUnsavedChangesRegistration({ scope, isDirty, discard })`.
- Produces: `GuardedLink`, plus `requestNavigation(proceed)` for form/logout actions.
- Produces: `useSettingsDraft({ key, version, baseline, values, isDirty, reset })`.

- [ ] **Step 1: Write RED tests for draft recovery and conflict behavior**

```ts
it('restores only when the server baseline still matches', () => {
  const storage = window.sessionStorage
  storage.clear()
  writeSettingsDraft(storage, 'biz:profile', 1, { name: 'A' }, { name: 'B' })
  expect(readSettingsDraft(storage, 'biz:profile', 1, { name: 'A' })).toEqual({
    kind: 'restored', values: { name: 'B' },
  })
  expect(readSettingsDraft(storage, 'biz:profile', 1, { name: 'C' })).toEqual({ kind: 'conflict' })
  expect(storage.getItem('biz:profile')).toBeNull()
})

it('rejects malformed and wrong-version drafts', () => {
  const storage = window.sessionStorage
  const baseline = { name: 'A' }
  storage.clear()
  storage.setItem('biz:profile', '{bad')
  expect(readSettingsDraft(storage, 'biz:profile', 1, baseline)).toEqual({ kind: 'none' })
})
```

- [ ] **Step 2: Run draft tests and verify RED**

Run: `npm test -- tests/unit/settings-draft.test.ts`

Expected: FAIL because the draft module does not exist.

- [ ] **Step 3: Implement pure draft helpers**

```ts
type FlatSettings = Record<string, unknown>
type DraftEnvelope<T extends FlatSettings> = { version: number; baseline: T; values: T }
type DraftRecovery<T extends FlatSettings> = { kind: 'none' } | { kind: 'restored'; values: T } | { kind: 'conflict' }

function sameFlatValues(a: FlatSettings, b: FlatSettings): boolean {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  return keys.every((key) => Object.is(a[key], b[key]))
}

export function readSettingsDraft<T extends FlatSettings>(storage: Storage, key: string, version: number, baseline: T): DraftRecovery<T> {
  const raw = storage.getItem(key)
  if (!raw) return { kind: 'none' }
  try {
    const parsed = JSON.parse(raw) as DraftEnvelope<T>
    if (parsed.version !== version) { storage.removeItem(key); return { kind: 'none' } }
    if (!sameFlatValues(parsed.baseline, baseline)) {
      storage.removeItem(key)
      return { kind: 'conflict' }
    }
    return { kind: 'restored', values: parsed.values }
  } catch {
    storage.removeItem(key)
    return { kind: 'none' }
  }
}
```

Keep `Storage` injected so tests never depend on global browser state.

- [ ] **Step 4: Write RED provider tests**

Render a real link and dialog, not a mocked child:

```tsx
const { mockPush, discard } = vi.hoisted(() => ({ mockPush: vi.fn(), discard: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))

function DirtyRegistration({ dirty }: { dirty: boolean }) {
  useUnsavedChangesRegistration({ scope: 'profile', isDirty: dirty, discard })
  return <GuardedLink href="/dashboard/bookings">Reservas</GuardedLink>
}

function GuardHarness({ dirty }: { dirty: boolean }) {
  return <UnsavedChangesProvider><DirtyRegistration dirty={dirty} /></UnsavedChangesProvider>
}

it('blocks owned navigation while dirty and proceeds after discard', async () => {
  render(<GuardHarness dirty />)
  await user.click(screen.getByRole('link', { name: 'Reservas' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('Cambios sin guardar')
  expect(mockPush).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Descartar cambios' }))
  expect(discard).toHaveBeenCalledOnce()
  expect(mockPush).toHaveBeenCalledWith('/dashboard/bookings')
})

it('does not block modifier clicks', () => {
  render(<GuardHarness dirty />)
  fireEvent.click(screen.getByRole('link', { name: 'Reservas' }), { ctrlKey: true })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(mockPush).not.toHaveBeenCalled()
})

it('registers beforeunload only while dirty', () => {
  const add = vi.spyOn(window, 'addEventListener')
  const remove = vi.spyOn(window, 'removeEventListener')
  const { rerender, unmount } = render(<GuardHarness dirty={false} />)
  expect(add).not.toHaveBeenCalledWith('beforeunload', expect.any(Function))
  rerender(<GuardHarness dirty />)
  expect(add).toHaveBeenCalledWith('beforeunload', expect.any(Function))
  unmount()
  expect(remove).toHaveBeenCalledWith('beforeunload', expect.any(Function))
})
```

- [ ] **Step 5: Run provider tests and verify RED**

Run: `npm test -- tests/unit/unsaved-changes-provider.test.tsx`

Expected: FAIL because provider and guarded link do not exist.

- [ ] **Step 6: Implement provider, dialog and dashboard integration**

```tsx
<VocabularyProvider value={...}>
  <UnsavedChangesProvider>
    <div className="flex min-h-screen ...">
      <DashboardSidebar ... />
      <main ...>{children}</main>
    </div>
  </UnsavedChangesProvider>
</VocabularyProvider>
```

`GuardedLink` accepts string `href`, preserves target/modifier behavior, calls `preventDefault()` only for an owned same-tab navigation while dirty, and uses `router.push(href)` after confirmation. Replace the desktop logo, all desktop nav links and all mobile nav links in `sidebar.tsx`; use `requestNavigation` around sign-out submit.

- [ ] **Step 7: Implement the hook connecting React Hook Form to drafts**

```ts
useEffect(() => {
  const recovery = readSettingsDraft(sessionStorage, key, version, baseline)
  if (recovery.kind === 'restored') reset(recovery.values)
  setRecovery(recovery.kind)
}, [key, version, baseline, reset])

useEffect(() => {
  if (isDirty) writeSettingsDraft(sessionStorage, key, version, baseline, values)
}, [baseline, isDirty, key, values, version])
```

Guard the first effect against Strict Mode replay and clear the draft after successful save or explicit discard. Expose `recovery` so forms can show “Recuperamos cambios sin guardar” or the conflict notice.

- [ ] **Step 8: Run focused tests and typecheck**

Run: `npm test -- tests/unit/settings-draft.test.ts tests/unit/unsaved-changes-provider.test.tsx tests/unit/dashboard-layout-redirect.test.tsx tests/unit/dashboard-navigation-layout.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add src/lib/business/settings-draft.ts src/components/dashboard/unsaved-changes-provider.tsx src/components/dashboard/settings/use-settings-draft.ts src/app/dashboard/layout.tsx src/components/dashboard/sidebar.tsx tests/unit/settings-draft.test.ts tests/unit/unsaved-changes-provider.test.tsx
git commit -m "feat: protect unsaved settings changes"
```

Review checkpoint: adversarially test Strict Mode, malformed storage, stale baseline, Cmd/Ctrl-click and sign-out.

---

### Task 3: Shared settings shell, navigation and save states

**Files:**
- Create: `src/lib/business/settings-navigation.ts`
- Create: `src/components/dashboard/settings/settings-shell.tsx`
- Create: `src/components/dashboard/settings/settings-navigation.tsx`
- Create: `src/components/dashboard/settings/settings-save-bar.tsx`
- Create: `src/components/dashboard/settings/settings-form-section.tsx`
- Create: `tests/unit/settings-shell.test.tsx`

**Interfaces:**
- Produces: `SETTINGS_SECTIONS` with keys `profile | reservations | policies | payments`.
- Produces: `SettingsShell({ children })`, `SettingsNavigation()`, `SettingsSaveBar(props)` and `SettingsFormSection(props)`.
- `payments` is the only section with `prefetch: false`.

- [ ] **Step 1: Write failing shell/navigation tests**

```tsx
const { mockPathname } = vi.hoisted(() => ({ mockPathname: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: mockPathname }))
vi.mock('@/components/dashboard/unsaved-changes-provider', () => ({
  GuardedLink: ({ href, prefetch, children, ...props }: React.ComponentProps<'a'> & { href: string; prefetch?: boolean }) => (
    <a href={href} data-prefetch={String(prefetch)} {...props}>{children}</a>
  ),
}))

it('renders one accessible current section and disables payment prefetch', () => {
  mockPathname('/dashboard/settings/policies')
  render(<SettingsNavigation />)
  expect(screen.getByRole('link', { name: 'Políticas y avisos' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: 'Pagos' })).toHaveAttribute('data-prefetch', 'false')
})

it('save bar names every state without relying on color', () => {
  const { rerender } = render(<SettingsSaveBar isDirty={false} isSubmitting={false} status="idle" />)
  expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
  rerender(<SettingsSaveBar isDirty isSubmitting status="idle" />)
  expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled()
})
```

- [ ] **Step 2: Run shell tests and verify RED**

Run: `npm test -- tests/unit/settings-shell.test.tsx`

Expected: FAIL because the shared components do not exist.

- [ ] **Step 3: Implement the route registry and visual shell**

```ts
export const SETTINGS_SECTIONS = [
  { key: 'profile', href: '/dashboard/settings/profile', label: 'Perfil público', prefetch: true },
  { key: 'reservations', href: '/dashboard/settings/reservations', label: 'Reservas', prefetch: true },
  { key: 'policies', href: '/dashboard/settings/policies', label: 'Políticas y avisos', prefetch: true },
  { key: 'payments', href: '/dashboard/settings/payments', label: 'Pagos', prefetch: false },
] as const
```

Use a sticky rail from `lg`, an overflow-x-auto row below `lg`, 44px minimum targets, `aria-current`, visible focus and `GuardedLink`. The shell should use a quiet border/active line rather than a card per nav item.

- [ ] **Step 4: Implement save bar and form section primitives**

`SettingsSaveBar` receives:

```ts
type SettingsSaveBarProps = {
  isDirty: boolean
  isSubmitting: boolean
  status: 'idle' | 'saved' | 'error'
  error?: string | null
}
```

It renders a sticky action row above the existing mobile nav (`bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-0`), an `aria-live="polite"` status and a submit button. `SettingsFormSection` renders semantic heading, description and fields without adding nested decorative cards.

- [ ] **Step 5: Run focused tests, typecheck and responsive source assertions**

Run: `npm test -- tests/unit/settings-shell.test.tsx && npm run typecheck && git diff --check`

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/lib/business/settings-navigation.ts src/components/dashboard/settings tests/unit/settings-shell.test.tsx
git commit -m "feat: add settings navigation shell"
```

Review checkpoint: verify 375px labels remain reachable, exactly one active section exists and Pagos does not prefetch.

---

### Task 4: Profile form and scoped live preview

**Files:**
- Create: `src/components/dashboard/settings/profile-settings-form.tsx`
- Create: `src/components/dashboard/settings/public-profile-preview.tsx`
- Create: `tests/unit/profile-settings-form.test.tsx`

**Interfaces:**
- Consumes: `ProfileSettingsInput`, `updateProfileSettings`, shared save bar/section, dirty registration and draft hook.
- Produces: `ProfileSettingsForm({ businessId, slug, initialValues })`.
- Produces: `PublicProfilePreview({ name, city, bio, logoUrl, publicUrl })`.

- [ ] **Step 1: Write RED component tests**

```tsx
const { mockUpdateProfile } = vi.hoisted(() => ({ mockUpdateProfile: vi.fn() }))
vi.mock('@/server/actions/business-settings', () => ({ updateProfileSettings: mockUpdateProfile }))

const profileValues: ProfileSettingsInput = {
  name: 'Mi Negocio', bio: '', profileImageUrl: '', logoUrl: '',
  whatsapp: '', instagram: '', addressText: '', city: 'Santiago', subdomain: 'mi-negocio',
}

function renderProfile() {
  return render(
    <UnsavedChangesProvider>
      <ProfileSettingsForm businessId="biz-1" slug="mi-negocio" initialValues={profileValues} />
    </UnsavedChangesProvider>,
  )
}

it('submits only profile fields and resets dirty state from normalized response', async () => {
  mockUpdateProfile.mockResolvedValue({ ok: true, data: { ...profileValues, whatsapp: '+56912345678' } })
  renderProfile()
  await user.clear(screen.getByLabelText('WhatsApp'))
  await user.type(screen.getByLabelText('WhatsApp'), '9 1234 5678')
  await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
  expect(mockUpdateProfile).toHaveBeenCalledWith(expect.not.objectContaining({ timezone: expect.anything() }))
  expect(screen.getByLabelText('WhatsApp')).toHaveValue('+56912345678')
  expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
})

it('updates preview from only watched profile fields', async () => {
  renderProfile()
  await user.type(screen.getByLabelText('Nombre del negocio'), ' nuevo')
  expect(screen.getByRole('heading', { name: /nuevo/i })).toBeVisible()
})
```

Also cover reserved subdomain error, restored-draft notice and conflict notice.

- [ ] **Step 2: Run profile tests and verify RED**

Run: `npm test -- tests/unit/profile-settings-form.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the profile form**

Use `useForm<ProfileSettingsInput>({ resolver: zodResolver(profileSettingsSchema), defaultValues: initialValues })`. Use `useWatch({ control, name: [...] })` only for `name`, `city`, `bio`, `logoUrl` and `subdomain`. On success call `reset(res.data)`, clear the draft and set status `saved`; on error retain all values and set status `error`.

Render logical groups “Identidad”, “Contacto y ubicación” and “Dirección pública”. Labels must say “Nombre del negocio”, not “Nombre del estudio”. Keep URL image inputs, but place their explanatory copy below the inputs rather than introducing an uploader.

- [ ] **Step 4: Implement the isolated preview**

Use the existing `getBusinessPublicUrl` contract. Keep external images as `<img>` in this task because arbitrary remote hosts are not configured for `next/image`; preserve meaningful `alt`, fixed dimensions and object-fit. At `xl`, render form and preview in `grid-cols-[minmax(0,1fr)_20rem]`; below `xl`, preview follows the form.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npm test -- tests/unit/profile-settings-form.test.tsx tests/unit/settings-shell.test.tsx && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/components/dashboard/settings/profile-settings-form.tsx src/components/dashboard/settings/public-profile-preview.tsx tests/unit/profile-settings-form.test.tsx
git commit -m "feat: add profile settings section"
```

Review checkpoint: confirm preview has no whole-form `watch()`, saved normalization resets dirty and arbitrary image failure does not break layout.

---

### Task 5: Reservation settings form

**Files:**
- Create: `src/components/dashboard/settings/reservation-settings-form.tsx`
- Create: `tests/unit/reservation-settings-form.test.tsx`

**Interfaces:**
- Consumes: `ReservationSettingsInput`, `updateReservationSettings`, shared form primitives, guard and draft hook.
- Produces: `ReservationSettingsForm({ businessId, initialValues })`.

- [ ] **Step 1: Write failing behavior tests**

```tsx
const { mockUpdate } = vi.hoisted(() => ({ mockUpdate: vi.fn() }))
vi.mock('@/server/actions/business-settings', () => ({ updateReservationSettings: mockUpdate }))

const reservationValues: ReservationSettingsInput = {
  timezone: 'America/Santiago', slotStepMinutes: '30', manualHoldHours: 24,
  requireBookingApproval: false, defaultMeetingUrl: '',
}

function renderReservations(overrides: Partial<ReservationSettingsInput> = {}) {
  return render(
    <UnsavedChangesProvider>
      <ReservationSettingsForm
        businessId="biz-1"
        initialValues={{ ...reservationValues, ...overrides }}
      />
    </UnsavedChangesProvider>,
  )
}

it('maps service duration to service and submits no policy fields', async () => {
  renderReservations({ slotStepMinutes: 'service' })
  expect(screen.getByLabelText('Ofrecer horas de reserva')).toHaveTextContent('Según la duración')
  await user.click(screen.getByLabelText('Confirmar cada reserva a mano'))
  await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
  expect(mockUpdate).toHaveBeenCalledWith(expect.not.objectContaining({ selfServiceCutoffHours: expect.anything() }))
})

it('links the manual hold explanation to payment settings without prefetch', () => {
  renderReservations()
  expect(screen.getByRole('link', { name: 'Configurar pagos' })).toHaveAttribute('href', '/dashboard/settings/payments')
})
```

Cover blank hold fallback, unsafe meeting URL rejection, switches and normalized reset.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/unit/reservation-settings-form.test.tsx`

Expected: FAIL because the form does not exist.

- [ ] **Step 3: Implement the reservation form**

Move TIMEZONES and SLOT_STEP_OPTIONS into this file or a sibling `reservation-options.ts` only if reused by tests. Preserve exact current value mappings and copy. Group “Agenda”, “Confirmación” and “Atención online”. Render CLP as quiet read-only information, not a disabled field competing with editable controls.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm test -- tests/unit/reservation-settings-form.test.tsx tests/unit/business-settings-schema.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/components/dashboard/settings/reservation-settings-form.tsx tests/unit/reservation-settings-form.test.tsx
git commit -m "feat: add reservation settings section"
```

Review checkpoint: verify no policy field appears in payload and payment link uses guarded navigation with prefetch disabled.

---

### Task 6: Policies and cancellation reminders form

**Files:**
- Create: `src/components/dashboard/settings/policy-settings-form.tsx`
- Create: `tests/unit/policy-settings-form.test.tsx`

**Interfaces:**
- Consumes: `PolicySettingsInput`, `updatePolicySettings`, shared form primitives, guard and draft hook.
- Produces: `PolicySettingsForm({ businessId, initialValues })`.

- [ ] **Step 1: Write failing ordering and payload tests**

```tsx
const { mockUpdate } = vi.hoisted(() => ({ mockUpdate: vi.fn() }))
vi.mock('@/server/actions/business-settings', () => ({ updatePolicySettings: mockUpdate }))

const policyValues: PolicySettingsInput = {
  selfServiceCutoffHours: 24, cancellationReminderEnabled: true,
  cancellationPolicy: '', bookingPolicy: '', depositPolicy: '',
}

function renderPolicies() {
  return render(
    <UnsavedChangesProvider>
      <PolicySettingsForm businessId="biz-1" initialValues={policyValues} />
    </UnsavedChangesProvider>,
  )
}

it('keeps the cancellation cutoff immediately before its dependent push switch', () => {
  renderPolicies()
  const cutoff = screen.getByLabelText('Ventana de autogestión (horas)')
  const push = screen.getByLabelText('Avisar antes del límite de cancelación')
  expect(cutoff.compareDocumentPosition(push) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('submits policies without reservation or profile fields', async () => {
  renderPolicies()
  await user.type(screen.getByLabelText('Política de reserva'), 'Con cita previa')
  await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
  expect(mockUpdate).toHaveBeenCalledWith(expect.not.objectContaining({ timezone: expect.anything(), name: expect.anything() }))
})
```

Cover cutoff `0`, blank cutoff fallback `24`, reminder disabled and all three textareas.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/unit/policy-settings-form.test.tsx`

Expected: FAIL because the form does not exist.

- [ ] **Step 3: Implement the policies form**

Render “Cancelación y autogestión” first, with cutoff followed by the Web Push switch and exact eligibility copy. Render “Condiciones visibles al reservar” second with cancellation, booking and deposit textareas. On save, reset from the action response so empty DB values return as empty textareas.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm test -- tests/unit/policy-settings-form.test.tsx tests/unit/business-settings-action.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```bash
git add src/components/dashboard/settings/policy-settings-form.tsx tests/unit/policy-settings-form.test.tsx
git commit -m "feat: add policy settings section"
```

Review checkpoint: compare copy and ordering against the push cancellation warning spec; this task must not alter reminder eligibility.

---

### Task 7: Wire nested routes and integrate Payments

**Files:**
- Create: `src/app/dashboard/settings/layout.tsx`
- Create: `src/lib/business/settings-access.ts`
- Modify: `src/app/dashboard/settings/page.tsx`
- Create: `src/app/dashboard/settings/profile/page.tsx`
- Create: `src/app/dashboard/settings/reservations/page.tsx`
- Create: `src/app/dashboard/settings/policies/page.tsx`
- Modify: `src/app/dashboard/settings/payments/page.tsx`
- Modify: `src/app/dashboard/settings/payments/bank-transfer-form.tsx`
- Create: `tests/unit/settings-routes.test.tsx`
- Modify: `tests/unit/bank-transfer-form.test.tsx`
- Modify: `tests/unit/bank-transfer-form-proof.test.tsx`

**Interfaces:**
- Consumes all components from Tasks 3–6.
- Produces the final URL structure and uniform `owner/admin` page authorization.
- Produces: cached server-only `requireSettingsPageAccess()` for layout/pages; actions continue using `requireBusinessRole` directly.
- Extends `BankTransferForm` with `businessId` only for its local draft key; payment actions still derive tenant from the session.

- [ ] **Step 1: Read installed Next.js 16 docs named in Global Constraints**

Record no prose file; use the docs to confirm nested layout preservation, `redirect()` semantics and `Link prefetch={false}` before writing route code.

- [ ] **Step 2: Write route tests before route changes**

```tsx
const { mockRequireSettingsPageAccess, mockPaymentProviderQuery } = vi.hoisted(() => ({
  mockRequireSettingsPageAccess: vi.fn(),
  mockPaymentProviderQuery: vi.fn(),
}))
vi.mock('@/lib/business/settings-access', () => ({ requireSettingsPageAccess: mockRequireSettingsPageAccess }))
vi.mock('@/lib/payments/factory', () => ({
  resolveOnlinePaymentAvailabilityForBusiness: mockPaymentProviderQuery,
}))

const settingsPages = {
  profile: ProfilePage,
  reservations: ReservationsPage,
  policies: PoliciesPage,
  payments: PaymentsPage,
}

it('redirects settings root to profile', async () => {
  await expect(SettingsRootPage()).rejects.toThrow('REDIRECT:/dashboard/settings/profile')
})

it.each(['profile', 'reservations', 'policies', 'payments'])('%s redirects staff before reading settings', async (section) => {
  mockRequireSettingsPageAccess.mockRejectedValue(new Error('REDIRECT:/dashboard'))
  await expect(settingsPages[section as keyof typeof settingsPages]()).rejects.toThrow('REDIRECT:/dashboard')
  expect(mockPaymentProviderQuery).not.toHaveBeenCalled()
})

it('serializes only profile fields into the profile client form', async () => {
  const tree = await ProfilePage()
  render(tree)
  expect(mockProfileForm).toHaveBeenCalledWith(expect.objectContaining({
    initialValues: expect.not.objectContaining({ timezone: expect.anything() }),
  }))
})
```

Mock full Business fixtures, but assert child props are section-minimal. For Pagos, assert `requireSettingsPageAccess()` resolves an owner/admin context before provider queries.

- [ ] **Step 3: Run route tests and verify RED**

Run: `npm test -- tests/unit/settings-routes.test.tsx`

Expected: FAIL because nested routes/layout are missing and root does not redirect.

- [ ] **Step 4: Implement the shared nested layout and root redirect**

```tsx
// src/lib/business/settings-access.ts
import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { AuthError, ForbiddenError, requireBusinessRole } from '@/lib/auth/server'

export const requireSettingsPageAccess = cache(async () => {
  try {
    return await requireBusinessRole(['owner', 'admin'])
  } catch (error) {
    if (error instanceof AuthError) redirect('/login')
    if (error instanceof ForbiddenError) redirect('/dashboard')
    throw error
  }
})

// src/app/dashboard/settings/layout.tsx
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireSettingsPageAccess()
  return (
    <div>
      <DashboardHeader title="Configuración" subtitle="Administra cómo se presenta y funciona tu negocio." />
      <SettingsShell>{children}</SettingsShell>
    </div>
  )
}

export default function SettingsPage() {
  redirect('/dashboard/settings/profile')
}
```

Unit-test the helper separately inside `settings-routes.test.tsx`: AuthError redirects to `/login`, ForbiddenError redirects to `/dashboard`, and unknown errors propagate unchanged. Do not catch the result of `redirect()` inside the helper.

- [ ] **Step 5: Implement the three section pages with minimal serialized props**

Each page calls cached `requireSettingsPageAccess()`, maps only owned fields to `initialValues`, and passes `business.id` solely for the local draft key. `businessId` never enters a mutation payload.

```tsx
const { business } = await requireSettingsPageAccess()
return <ProfileSettingsForm businessId={business.id} slug={business.slug} initialValues={{
  name: business.name,
  bio: business.bio ?? '',
  profileImageUrl: business.profileImageUrl ?? '',
  logoUrl: business.logoUrl ?? '',
  whatsapp: business.whatsapp ?? '',
  instagram: business.instagram ?? '',
  addressText: business.addressText ?? '',
  city: business.city,
  subdomain: business.subdomain,
}} />
```

- [ ] **Step 6: Integrate Payments without changing provider logic**

Remove its `DashboardHeader` and outer route padding because the settings layout owns both. Replace `getCurrentUserWithBusiness()` authorization with `requireSettingsPageAccess()`; continue fetching account, availability, bank account and flags in parallel after authorization. Keep Mercado Pago, R2 and bank transfer actions unchanged.

Pass `businessId={businessId}` to `BankTransferForm`. In that client component, derive a flat baseline from `account`, compute dirty against current `form`, register it with `useUnsavedChangesRegistration`, and use `useSettingsDraft` under key `settings:${businessId}:payments-bank:v1`. After `saveBankTransferAccount` succeeds, update the local baseline to the submitted values and clear the draft; immediate toggles for enable/proof remain immediate and do not participate in dirty state.

Add this regression to `bank-transfer-form.test.tsx`:

```tsx
it('protects edited bank details and clears dirty state after save', async () => {
  render(
    <UnsavedChangesProvider>
      <BankTransferForm businessId="biz-1" account={account} requireProof={false} proofUploadAvailable />
      <GuardedLink href="/dashboard/settings/profile">Perfil público</GuardedLink>
    </UnsavedChangesProvider>,
  )
  await user.clear(screen.getByLabelText('Banco'))
  await user.type(screen.getByLabelText('Banco'), 'Banco de Chile')
  await user.click(screen.getByRole('link', { name: 'Perfil público' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('Cambios sin guardar')
  await user.click(screen.getByRole('button', { name: 'Seguir editando' }))
  await user.click(screen.getByRole('button', { name: 'Guardar datos bancarios' }))
  await user.click(screen.getByRole('link', { name: 'Perfil público' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
```

- [ ] **Step 7: Run route/payment regressions and typecheck**

Run: `npm test -- tests/unit/settings-routes.test.tsx tests/unit/bank-transfer-form.test.tsx tests/unit/bank-transfer-form-proof.test.tsx tests/unit/dashboard-layout-redirect.test.tsx && npm run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit Task 7**

```bash
git add src/app/dashboard/settings src/lib/business/settings-access.ts tests/unit/settings-routes.test.tsx tests/unit/bank-transfer-form.test.tsx tests/unit/bank-transfer-form-proof.test.tsx
git commit -m "feat: split settings into nested routes"
```

Review checkpoint: inspect Next route boundaries, permission order, payment query isolation and active sidebar behavior on every descendant.

---

### Task 8: Remove monolith, add E2E coverage and close verification

**Files:**
- Delete: `src/components/dashboard/settings-form.tsx`
- Modify: `src/lib/business/schema.ts`
- Modify: `src/server/actions/business-settings.ts`
- Modify: `tests/unit/business-settings-schema.test.ts`
- Modify: `tests/unit/business-settings-action.test.ts`
- Create: `tests/e2e/settings.spec.ts`
- Modify: `docs/superpowers/specs/2026-08-18-settings-information-architecture-design.md`

**Interfaces:**
- Removes: `updateBusinessSchema`, `UpdateBusinessInput`, `UpdateBusinessOutput`, `updateBusinessSettings`, `SettingsForm`.
- Leaves only section-scoped public contracts.

- [ ] **Step 1: Prove legacy symbols have no production consumers**

Run:

```bash
rg -n "SettingsForm|updateBusinessSettings|updateBusinessSchema|UpdateBusiness(Input|Output)" src tests --glob '*.{ts,tsx}'
```

Expected: matches only the legacy definitions and tests being replaced. If a real consumer remains, migrate it to the owning section before deletion.

- [ ] **Step 2: Delete the monolith and migrate legacy tests**

Remove the old component, action and composed schema. Keep `slotStepToMinutes` and the three section schemas/types. Rename old test descriptions to the section action/schema they now exercise; do not weaken existing URL, normalization, authorization, subdomain or cutoff assertions.

- [ ] **Step 3: Write Playwright tests for desktop and mobile journeys**

```ts
test.describe('settings navigation', () => {
  test.beforeEach(async ({ page }) => { setOwnerAuth(page) })

  for (const viewport of [{ width: 375, height: 812 }, { width: 1440, height: 900 }]) {
    test(`navigates and saves at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/dashboard/settings')
      await expect(page).toHaveURL(/\/dashboard\/settings\/profile$/)
      await page.getByRole('link', { name: 'Reservas', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Reservas' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
    })
  }
})

test('warns before discarding and restores a Back navigation draft', async ({ page }) => {
  await page.goto('/dashboard')
  await page.goto('/dashboard/settings/profile')
  await page.getByLabel('Bio').fill(`Borrador ${Date.now()}`)
  await page.getByRole('link', { name: 'Reservas', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Cambios sin guardar')
  await page.getByRole('button', { name: 'Seguir editando' }).click()
  page.on('dialog', dialog => dialog.accept())
  await page.goBack()
  await expect(page).toHaveURL('/dashboard')
  await page.goForward()
  await expect(page).toHaveURL(/\/dashboard\/settings\/profile$/)
  await expect(page.getByText('Recuperamos cambios sin guardar')).toBeVisible()
})
```

Also verify Pagos is reachable, the profile preview is sticky only at desktop, save bar does not overlap mobile nav, and a staff-role user cannot enter any settings route. Restore any mutated seeded setting in `afterEach` or use the original value captured before editing.

- [ ] **Step 4: Run the focused unit and E2E suites**

Run:

```bash
npm test -- \
  tests/unit/business-settings-schema.test.ts \
  tests/unit/business-settings-action.test.ts \
  tests/unit/settings-draft.test.ts \
  tests/unit/unsaved-changes-provider.test.tsx \
  tests/unit/settings-shell.test.tsx \
  tests/unit/profile-settings-form.test.tsx \
  tests/unit/reservation-settings-form.test.tsx \
  tests/unit/policy-settings-form.test.tsx \
  tests/unit/settings-routes.test.tsx \
  tests/unit/bank-transfer-form.test.tsx \
  tests/unit/bank-transfer-form-proof.test.tsx
npx playwright test tests/e2e/settings.spec.ts --project=chromium
```

Expected: all focused tests PASS.

- [ ] **Step 5: Run full verification**

Run:

```bash
npm test -- --silent --reporter=dot
npm run test:integration
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: unit and PostgreSQL integration suites exit 0, typecheck exit 0, lint 0 errors, production build exit 0 and clean diff check. Classify any baseline warning separately; do not label an unclassified failure flaky.

- [ ] **Step 6: Perform visual QA at all required widths**

Capture `/dashboard/settings/profile`, `/reservations`, `/policies` and `/payments` at 375, 768, 1024 and 1440 px. Verify no horizontal overflow, no overlap with mobile nav/save bar, rail stickiness, reachable labels, focus order and that the preview does not leave a large empty second column.

- [ ] **Step 7: Update spec state and commit Task 8**

Change the spec state to `implementado; QA real pendiente de despliegue`, then:

```bash
git add -A
git commit -m "test: cover settings user journeys"
```

Review checkpoint: request an independent exact-diff review covering UX, security boundaries, stale writes, draft recovery, responsive behavior and payment regressions. Fix every Critical/Important finding with a fresh RED/GREEN cycle before merge.

---

## Final Merge Gate

Before PR/merge, refresh `origin/main`, confirm the branch base and worktree cleanliness, rerun any check invalidated by review fixes, and verify the exact reviewed HEAD. Merge only after the independent reviewer returns READY and GitHub checks for that SHA are green. Preserve the worktree if a PR remains open; remove only the worktree created for this feature after the merge is verified.
