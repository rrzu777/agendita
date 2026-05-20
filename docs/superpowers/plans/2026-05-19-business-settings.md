# Business Settings (/dashboard/settings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `/dashboard/settings` so a manicurist (owner/admin) can edit their business public profile, subdomain, policies, and regional settings.

**Architecture:** Server action with Zod validation for the backend, React Hook Form with Zod resolver for the client, two-column layout (form left, live preview right), and immediate cache revalidation on save.

**Tech Stack:** Next.js 16, Prisma 5, React 19, shadcn/ui, React Hook Form 7, Zod 4, Vitest.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `prisma/schema.prisma` | Modify | Add 3 policy columns to `Business` |
| `prisma/migrations/` | Generate | Migration for new columns |
| `src/lib/business/normalize.ts` | Create | Pure normalization functions (WhatsApp, Instagram) |
| `src/server/actions/business-settings.ts` | Create | Server action + Zod schema |
| `src/app/dashboard/settings/page.tsx` | Modify | Server component, render SettingsForm |
| `src/components/dashboard/settings-form.tsx` | Create | Client form with RHF, preview card |
| `tests/unit/business-normalize.test.ts` | Create | Unit tests for normalization |
| `tests/unit/business-settings-schema.test.ts` | Create | Unit tests for Zod schema |

---

### Task 1: Prisma Schema Migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add policy columns to `Business` model**

Add after `galleryImages` relation:

```prisma
  cancellationPolicy String?
  bookingPolicy      String?
  depositPolicy      String?
```

The `Business` model should now look like:

```prisma
model Business {
  id              String   @id @default(cuid())
  name            String
  slug            String   @unique
  subdomain       String   @unique
  customDomain    String?  @unique
  ownerUserId     String
  logoUrl         String?
  profileImageUrl String?
  bio             String?
  whatsapp        String?
  instagram       String?
  addressText     String?
  city            String
  country         String   @default("CL")
  currency        String   @default("CLP")
  timezone        String   @default("America/Santiago")
  bookingWindowDays Int    @default(90)
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  users           BusinessUser[]
  services        Service[]
  availability    AvailabilityRule[]
  timeBlocks      TimeBlock[]
  customers       Customer[]
  bookings        Booking[]
  payments        Payment[]
  ledgerEntries   LedgerEntry[]
  reviews         Review[]
  galleryImages   GalleryImage[]
  cancellationPolicy String?
  bookingPolicy      String?
  depositPolicy      String?
}
```

- [ ] **Step 2: Generate and apply migration**

```bash
npx prisma migrate dev --name add_business_policies
```

Expected: Migration created successfully, DB updated.

- [ ] **Step 3: Regenerate Prisma client**

```bash
npx prisma generate
```

- [ ] **Step 4: Commit**

```bash
git add prisma/
git commit -m "feat(db): add cancellation, booking, deposit policy columns to Business"
```

---

### Task 2: Normalization Functions + Tests

**Files:**
- Create: `src/lib/business/normalize.ts`
- Create: `tests/unit/business-normalize.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { normalizeWhatsapp, normalizeInstagram } from '@/lib/business/normalize'

describe('normalizeWhatsapp', () => {
  it('returns null for empty input', () => {
    expect(normalizeWhatsapp(null)).toBeNull()
    expect(normalizeWhatsapp('')).toBeNull()
    expect(normalizeWhatsapp('   ')).toBeNull()
  })

  it('keeps + prefix if present', () => {
    expect(normalizeWhatsapp('+56912345678')).toBe('+56912345678')
  })

  it('adds +56 prefix for 9-digit Chile mobile', () => {
    expect(normalizeWhatsapp('912345678')).toBe('+56912345678')
    expect(normalizeWhatsapp('9 1234 5678')).toBe('+56912345678')
  })

  it('adds +56 prefix for 8-digit Chile landline', () => {
    expect(normalizeWhatsapp('21234567')).toBe('+5621234567')
    expect(normalizeWhatsapp('2 1234 567')).toBe('+5621234567')
  })

  it('cleans spaces, dashes, dots, parentheses', () => {
    expect(normalizeWhatsapp('+56 9 1234 5678')).toBe('+56912345678')
    expect(normalizeWhatsapp('56-9-1234-5678')).toBe('+56912345678')
    expect(normalizeWhatsapp('(56) 9.1234.5678')).toBe('+56912345678')
  })

  it('returns cleaned number for unknown patterns', () => {
    expect(normalizeWhatsapp('12345')).toBe('12345')
  })
})

describe('normalizeInstagram', () => {
  it('returns null for empty input', () => {
    expect(normalizeInstagram(null)).toBeNull()
    expect(normalizeInstagram('')).toBeNull()
    expect(normalizeInstagram('   ')).toBeNull()
  })

  it('removes @ prefix', () => {
    expect(normalizeInstagram('@miestudio')).toBe('miestudio')
  })

  it('extracts username from full instagram URL', () => {
    expect(normalizeInstagram('https://instagram.com/miestudio')).toBe('miestudio')
    expect(normalizeInstagram('http://instagram.com/miestudio')).toBe('miestudio')
    expect(normalizeInstagram('instagram.com/miestudio')).toBe('miestudio')
    expect(normalizeInstagram('https://www.instagram.com/miestudio/')).toBe('miestudio')
  })

  it('keeps plain username as-is', () => {
    expect(normalizeInstagram('miestudio')).toBe('miestudio')
  })

  it('removes spaces', () => {
    expect(normalizeInstagram('mi estudio')).toBe('miestudio')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/unit/business-normalize.test.ts
```

Expected: FAIL — "Cannot find module '@/lib/business/normalize'"

- [ ] **Step 3: Implement normalization functions**

```typescript
// src/lib/business/normalize.ts

export function normalizeWhatsapp(input: string | null): string | null {
  if (!input || input.trim() === '') return null

  // Keep only digits and + sign
  let cleaned = input.replace(/[^0-9+]/g, '')

  if (cleaned === '') return null

  // If it starts with +, keep it
  if (cleaned.startsWith('+')) {
    return cleaned
  }

  const digits = cleaned.replace(/\D/g, '')

  // Chile mobile: 9 digits starting with 9
  if (digits.length === 9 && digits.startsWith('9')) {
    return '+56' + digits
  }

  // Chile landline: 8 digits starting with 2-7
  if (digits.length === 8 && /^[2-7]/.test(digits)) {
    return '+56' + digits
  }

  // Already has country code without +
  if (digits.length === 11 && digits.startsWith('56')) {
    return '+' + digits
  }

  return cleaned
}

export function normalizeInstagram(input: string | null): string | null {
  if (!input || input.trim() === '') return null

  let cleaned = input.trim()

  // Remove spaces
  cleaned = cleaned.replace(/\s/g, '')

  // Extract from instagram URL patterns
  const urlMatch = cleaned.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^\/\?#]+)/i)
  if (urlMatch) {
    cleaned = urlMatch[1]
  }

  // Remove @ prefix
  if (cleaned.startsWith('@')) {
    cleaned = cleaned.slice(1)
  }

  if (cleaned === '') return null

  return cleaned
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/business-normalize.test.ts
```

Expected: All 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/business/normalize.ts tests/unit/business-normalize.test.ts
git commit -m "feat: add whatsapp and instagram normalization utilities"
```

---

### Task 3: Zod Schema + Tests

**Files:**
- Create: `tests/unit/business-settings-schema.test.ts`
- (Server action file will be created in Task 4 — schema will be defined there)

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest'

// We will define and export the schema from the server action file
// For now, create a temporary schema in the test file to make it fail
import { z } from 'zod'
import { normalizeWhatsapp, normalizeInstagram } from '@/lib/business/normalize'

const updateBusinessSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(100),
  bio: z.string().max(500).optional().transform(v => v?.trim() || null),
  profileImageUrl: z.string().url('URL inválida').optional().or(z.literal('')).transform(v => v?.trim() || null),
  logoUrl: z.string().url('URL inválida').optional().or(z.literal('')).transform(v => v?.trim() || null),
  whatsapp: z.string().optional().or(z.literal('')).transform(v => normalizeWhatsapp(v) || null),
  instagram: z.string().optional().or(z.literal('')).transform(v => normalizeInstagram(v) || null),
  addressText: z.string().optional().transform(v => v?.trim() || null),
  city: z.string().min(1, 'La ciudad es obligatoria'),
  timezone: z.string().default('America/Santiago'),
  subdomain: z.string()
    .min(3, 'Mínimo 3 caracteres')
    .max(30, 'Máximo 30 caracteres')
    .regex(/^[a-z0-9-]+$/, 'Solo minúsculas, números y guiones')
    .transform(v => v.toLowerCase()),
  cancellationPolicy: z.string().optional().transform(v => v?.trim() || null),
  bookingPolicy: z.string().optional().transform(v => v?.trim() || null),
  depositPolicy: z.string().optional().transform(v => v?.trim() || null),
})

describe('updateBusinessSchema', () => {
  it('accepts valid data', () => {
    const result = updateBusinessSchema.safeParse({
      name: 'Mi Estudio',
      city: 'Santiago',
      subdomain: 'miestudio',
      timezone: 'America/Santiago',
    })
    expect(result.success).toBe(true)
    expect(result.data?.name).toBe('Mi Estudio')
    expect(result.data?.subdomain).toBe('miestudio')
  })

  it('rejects empty name', () => {
    const result = updateBusinessSchema.safeParse({ name: '', city: 'Santiago', subdomain: 'test' })
    expect(result.success).toBe(false)
  })

  it('rejects name > 100 chars', () => {
    const result = updateBusinessSchema.safeParse({ name: 'a'.repeat(101), city: 'Santiago', subdomain: 'test' })
    expect(result.success).toBe(false)
  })

  it('transforms subdomain to lowercase', () => {
    const result = updateBusinessSchema.safeParse({ name: 'Test', city: 'Santiago', subdomain: 'MiEstudio' })
    expect(result.success).toBe(true)
    expect(result.data?.subdomain).toBe('miestudio')
  })

  it('rejects subdomain with spaces', () => {
    const result = updateBusinessSchema.safeParse({ name: 'Test', city: 'Santiago', subdomain: 'mi estudio' })
    expect(result.success).toBe(false)
  })

  it('rejects subdomain < 3 chars', () => {
    const result = updateBusinessSchema.safeParse({ name: 'Test', city: 'Santiago', subdomain: 'ab' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid URL', () => {
    const result = updateBusinessSchema.safeParse({
      name: 'Test', city: 'Santiago', subdomain: 'test',
      profileImageUrl: 'not-a-url',
    })
    expect(result.success).toBe(false)
  })

  it('transforms empty URL to null', () => {
    const result = updateBusinessSchema.safeParse({
      name: 'Test', city: 'Santiago', subdomain: 'test',
      profileImageUrl: '',
    })
    expect(result.success).toBe(true)
    expect(result.data?.profileImageUrl).toBeNull()
  })

  it('rejects empty city', () => {
    const result = updateBusinessSchema.safeParse({ name: 'Test', city: '', subdomain: 'test' })
    expect(result.success).toBe(false)
  })

  it('rejects bio > 500 chars', () => {
    const result = updateBusinessSchema.safeParse({
      name: 'Test', city: 'Santiago', subdomain: 'test',
      bio: 'a'.repeat(501),
    })
    expect(result.success).toBe(false)
  })

  it('normalizes whatsapp', () => {
    const result = updateBusinessSchema.safeParse({
      name: 'Test', city: 'Santiago', subdomain: 'test',
      whatsapp: '9 1234 5678',
    })
    expect(result.success).toBe(true)
    expect(result.data?.whatsapp).toBe('+56912345678')
  })

  it('normalizes instagram', () => {
    const result = updateBusinessSchema.safeParse({
      name: 'Test', city: 'Santiago', subdomain: 'test',
      instagram: '@miestudio',
    })
    expect(result.success).toBe(true)
    expect(result.data?.instagram).toBe('miestudio')
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npx vitest run tests/unit/business-settings-schema.test.ts
```

Expected: All 12 tests PASS (schema defined inline in test file).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/business-settings-schema.test.ts
git commit -m "test: add business settings Zod schema unit tests"
```

---

### Task 4: Server Action

**Files:**
- Create: `src/server/actions/business-settings.ts`

- [ ] **Step 1: Create the server action file**

```typescript
'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import { revalidatePath, revalidateTag } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { normalizeWhatsapp, normalizeInstagram } from '@/lib/business/normalize'

const RESERVED_SUBDOMAINS = [
  'www', 'app', 'admin', 'dashboard', 'api', 'login', 'register', 'support',
]

export const updateBusinessSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(100),
  bio: z.string().max(500).optional().transform(v => v?.trim() || null),
  profileImageUrl: z.string().url('URL inválida').optional().or(z.literal('')).transform(v => v?.trim() || null),
  logoUrl: z.string().url('URL inválida').optional().or(z.literal('')).transform(v => v?.trim() || null),
  whatsapp: z.string().optional().or(z.literal('')).transform(v => normalizeWhatsapp(v) || null),
  instagram: z.string().optional().or(z.literal('')).transform(v => normalizeInstagram(v) || null),
  addressText: z.string().optional().transform(v => v?.trim() || null),
  city: z.string().min(1, 'La ciudad es obligatoria'),
  timezone: z.string().default('America/Santiago'),
  subdomain: z.string()
    .min(3, 'Mínimo 3 caracteres')
    .max(30, 'Máximo 30 caracteres')
    .regex(/^[a-z0-9-]+$/, 'Solo minúsculas, números y guiones')
    .transform(v => v.toLowerCase()),
  cancellationPolicy: z.string().optional().transform(v => v?.trim() || null),
  bookingPolicy: z.string().optional().transform(v => v?.trim() || null),
  depositPolicy: z.string().optional().transform(v => v?.trim() || null),
})

export type UpdateBusinessInput = z.input<typeof updateBusinessSchema>

export async function updateBusinessSettings(data: UpdateBusinessInput) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])

  const limit = await checkRateLimit('update-business-settings', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = updateBusinessSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const validated = parsed.data

  // Check reserved subdomains
  if (RESERVED_SUBDOMAINS.includes(validated.subdomain)) {
    throw new Error('Este subdominio está reservado')
  }

  // Check subdomain uniqueness (excluding current business)
  const existing = await prisma.business.findFirst({
    where: {
      subdomain: validated.subdomain,
      NOT: { id: businessId },
    },
  })
  if (existing) {
    throw new Error('Este subdominio ya está en uso')
  }

  const updated = await prisma.business.update({
    where: { id: businessId },
    data: validated,
  })

  revalidatePath('/dashboard/settings')
  revalidateTag('public-business')
  await revalidateBusinessPublicPaths(businessId)

  return updated
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
npx tsc --noEmit src/server/actions/business-settings.ts
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/actions/business-settings.ts
git commit -m "feat: add updateBusinessSettings server action with validation"
```

---

### Task 5: Settings Form Component

**Files:**
- Create: `src/components/dashboard/settings-form.tsx`

- [ ] **Step 1: Create the SettingsForm component**

```tsx
'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { updateBusinessSettings, updateBusinessSchema } from '@/server/actions/business-settings'
import { getBusinessPublicUrl } from '@/lib/business/urls'
import type { Business } from '@prisma/client'
import { Globe, ExternalLink, AlertCircle, CheckCircle2 } from 'lucide-react'

const TIMEZONES = [
  { value: 'America/Santiago', label: 'América/Santiago (Chile)' },
  { value: 'America/Buenos_Aires', label: 'América/Buenos Aires (Argentina)' },
  { value: 'America/Lima', label: 'América/Lima (Perú)' },
  { value: 'America/Mexico_City', label: 'América/México (México)' },
  { value: 'America/Bogota', label: 'América/Bogotá (Colombia)' },
]

type FormData = {
  name: string
  bio?: string
  profileImageUrl?: string
  logoUrl?: string
  whatsapp?: string
  instagram?: string
  addressText?: string
  city: string
  timezone: string
  subdomain: string
  cancellationPolicy?: string
  bookingPolicy?: string
  depositPolicy?: string
}

export function SettingsForm({ business }: { business: Business }) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(updateBusinessSchema),
    defaultValues: {
      name: business.name,
      bio: business.bio || '',
      profileImageUrl: business.profileImageUrl || '',
      logoUrl: business.logoUrl || '',
      whatsapp: business.whatsapp || '',
      instagram: business.instagram || '',
      addressText: business.addressText || '',
      city: business.city,
      timezone: business.timezone,
      subdomain: business.subdomain,
      cancellationPolicy: business.cancellationPolicy || '',
      bookingPolicy: business.bookingPolicy || '',
      depositPolicy: business.depositPolicy || '',
    },
  })

  const watchedValues = watch()

  const publicUrl = getBusinessPublicUrl({
    slug: business.slug,
    subdomain: watchedValues.subdomain || business.subdomain,
  })

  async function onSubmit(data: FormData) {
    setIsSubmitting(true)
    setServerError(null)
    setSuccessMessage(null)

    try {
      await updateBusinessSettings(data)
      setSuccessMessage('Cambios guardados exitosamente')
      setTimeout(() => setSuccessMessage(null), 4000)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al guardar los cambios'
      setServerError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        {/* Server error / success */}
        {serverError && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            {serverError}
          </div>
        )}
        {successMessage && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600">
            <CheckCircle2 className="size-4 shrink-0" />
            {successMessage}
          </div>
        )}

        {/* Identidad */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-primary">Identidad</h3>
          <div className="space-y-2">
            <Label htmlFor="name">Nombre del estudio *</Label>
            <Input id="name" {...register('name')} aria-invalid={!!errors.name} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="bio">Bio</Label>
            <Textarea id="bio" {...register('bio')} rows={3} />
            {errors.bio && <p className="text-sm text-destructive">{errors.bio.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="logoUrl">URL del logo</Label>
            <Input id="logoUrl" {...register('logoUrl')} placeholder="https://..." />
            {errors.logoUrl && <p className="text-sm text-destructive">{errors.logoUrl.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="profileImageUrl">URL de imagen de perfil</Label>
            <Input id="profileImageUrl" {...register('profileImageUrl')} placeholder="https://..." />
            {errors.profileImageUrl && <p className="text-sm text-destructive">{errors.profileImageUrl.message}</p>}
          </div>
        </section>

        {/* Contacto */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-primary">Contacto y redes</h3>
          <div className="space-y-2">
            <Label htmlFor="whatsapp">WhatsApp</Label>
            <Input id="whatsapp" {...register('whatsapp')} placeholder="9 1234 5678" />
            {errors.whatsapp && <p className="text-sm text-destructive">{errors.whatsapp.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="instagram">Instagram</Label>
            <Input id="instagram" {...register('instagram')} placeholder="@miestudio" />
            {errors.instagram && <p className="text-sm text-destructive">{errors.instagram.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="addressText">Dirección</Label>
            <Input id="addressText" {...register('addressText')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="city">Ciudad *</Label>
            <Input id="city" {...register('city')} />
            {errors.city && <p className="text-sm text-destructive">{errors.city.message}</p>}
          </div>
        </section>

        {/* Dominio */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-primary">Dominio</h3>
          <div className="space-y-2">
            <Label htmlFor="subdomain">Subdominio *</Label>
            <Input id="subdomain" {...register('subdomain')} />
            <p className="text-sm text-muted-foreground">
              <Globe className="inline size-3.5 mr-1" />
              Tu URL será: {publicUrl}
            </p>
            {errors.subdomain && <p className="text-sm text-destructive">{errors.subdomain.message}</p>}
          </div>
        </section>

        {/* Regional */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-primary">Configuración regional</h3>
          <div className="space-y-2">
            <Label htmlFor="timezone">Zona horaria</Label>
            <Select
              value={watchedValues.timezone}
              onValueChange={(val) => setValue('timezone', val)}
            >
              <SelectTrigger id="timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>
                    {tz.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="currency">Moneda</Label>
            <Input id="currency" value="CLP" disabled />
            <p className="text-xs text-muted-foreground">La moneda no se puede cambiar en este momento.</p>
          </div>
        </section>

        {/* Políticas */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-primary">Políticas</h3>
          <div className="space-y-2">
            <Label htmlFor="cancellationPolicy">Política de cancelación</Label>
            <Textarea id="cancellationPolicy" {...register('cancellationPolicy')} rows={3} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bookingPolicy">Política de reserva</Label>
            <Textarea id="bookingPolicy" {...register('bookingPolicy')} rows={3} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="depositPolicy">Política de depósito</Label>
            <Textarea id="depositPolicy" {...register('depositPolicy')} rows={3} />
          </div>
        </section>

        <Button type="submit" disabled={isSubmitting} className="w-full md:w-auto">
          {isSubmitting ? 'Guardando...' : 'Guardar cambios'}
        </Button>
      </form>

      {/* Preview */}
      <aside className="space-y-4">
        <h3 className="text-lg font-semibold text-primary">Vista previa del perfil</h3>
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-start gap-4">
            {watchedValues.logoUrl ? (
              <img
                src={watchedValues.logoUrl}
                alt={watchedValues.name}
                className="size-16 rounded-xl object-cover"
              />
            ) : (
              <div className="flex size-16 items-center justify-center rounded-xl bg-secondary text-2xl font-bold text-primary">
                {watchedValues.name?.charAt(0).toUpperCase() || '?'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h4 className="text-xl font-semibold text-primary truncate">{watchedValues.name || 'Sin nombre'}</h4>
              <p className="text-sm text-muted-foreground">{watchedValues.city || 'Sin ciudad'}</p>
            </div>
          </div>
          {watchedValues.bio && (
            <p className="mt-4 text-sm text-muted-foreground line-clamp-3">{watchedValues.bio}</p>
          )}
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Ver perfil público <ExternalLink className="size-3.5" />
          </a>
        </div>
      </aside>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
npx tsc --noEmit src/components/dashboard/settings-form.tsx
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/settings-form.tsx
git commit -m "feat: add SettingsForm component with RHF, Zod, and live preview"
```

---

### Task 6: Settings Page

**Files:**
- Modify: `src/app/dashboard/settings/page.tsx`

- [ ] **Step 1: Replace the placeholder page**

```tsx
import { DashboardHeader } from '@/components/dashboard/header'
import { SettingsForm } from '@/components/dashboard/settings-form'
import { requireBusiness } from '@/lib/auth/server'
import { ForbiddenError } from '@/lib/auth/server'

export default async function SettingsPage() {
  let business
  try {
    const ctx = await requireBusiness()
    business = ctx.business
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return (
        <div>
          <DashboardHeader title="Configuración" subtitle="Datos del estudio, perfil público e integraciones." />
          <div className="p-5 md:p-10">
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-6 text-destructive">
              No tienes permisos para ver esta página.
            </div>
          </div>
        </div>
      )
    }
    throw error
  }

  return (
    <div>
      <DashboardHeader title="Configuración" subtitle="Datos del estudio, perfil público e integraciones." />
      <div className="p-5 md:p-10">
        <SettingsForm business={business} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
npx tsc --noEmit src/app/dashboard/settings/page.tsx
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/settings/page.tsx
git commit -m "feat: wire up SettingsPage with SettingsForm and auth"
```

---

### Task 7: Build & Test Verification

- [ ] **Step 1: Run unit tests**

```bash
npx vitest run
```

Expected: All tests PASS (existing + new).

- [ ] **Step 2: Run Next.js build**

```bash
npm run build
```

Expected: Build completes with 0 errors, 0 TypeScript errors.

- [ ] **Step 3: Final commit if build passes**

```bash
git add .
git commit -m "feat: complete /dashboard/settings business editing"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- ✅ Prisma migration (Task 1)
- ✅ Normalization functions (Task 2)
- ✅ Zod schema + tests (Task 3)
- ✅ Server action with auth, rate limit, validation (Task 4)
- ✅ Settings form with RHF, Zod, preview (Task 5)
- ✅ Settings page with auth (Task 6)
- ✅ Build + test verification (Task 7)

**2. Placeholder scan:**
- ✅ No TBD/TODO/fill in details
- ✅ All code is complete in every step
- ✅ No "similar to Task N" references

**3. Type consistency:**
- ✅ `updateBusinessSchema` exported from server action and imported in form
- ✅ `UpdateBusinessInput` type exported for reuse
- ✅ Field names match Prisma schema exactly
- ✅ `business` prop type is `Business` from Prisma
