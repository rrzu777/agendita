'use server'

import { createClient } from './middleware'
import { prisma } from '@/lib/db'
import { redirect } from 'next/navigation'
import { validateSubdomain } from '@/lib/business/subdomain'
import { createBusinessForUser, parseBusinessCategory } from '@/lib/business/create-for-user'
import { RegistrationError } from './registration-error'
import { action } from '@/lib/actions/result'
import { Prisma } from '@prisma/client'
import { getAppUrl } from '@/lib/business/urls'
import { sanitizeNext } from './sanitize-next'


export async function signIn(formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    return { error: 'Email y contraseña son requeridos' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { error: 'Email o contraseña incorrectos' }
  }

  redirect('/dashboard')
}

export async function requestPasswordReset(formData: FormData) {
  const email = (formData.get('email') as string | null)?.trim()
  if (!email) {
    return { error: 'Ingresa tu email' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: getAppUrl('/auth/callback?next=/reset-password'),
  })

  if (error) {
    return { error: 'No pudimos enviar el email de recuperación. Intenta de nuevo.' }
  }

  return { success: true }
}

export async function updatePassword(formData: FormData) {
  const password = (formData.get('password') as string | null) || ''
  if (password.length < 6) {
    return { error: 'La contraseña debe tener al menos 6 caracteres' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    return { error: 'No pudimos actualizar tu contraseña. Solicita un nuevo enlace.' }
  }

  return { success: true }
}

export async function checkSubdomainAvailability(subdomain: string) {
  const validation = validateSubdomain(subdomain)
  if (!validation.valid) {
    return { available: false, error: validation.error }
  }

  const existing = await prisma.business.findUnique({
    where: { subdomain: validation.sanitized! },
    select: { id: true },
  })

  return { available: !existing, error: existing ? 'Este subdominio ya está en uso' : undefined }
}

async function _signUp(formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const name = formData.get('name') as string
  const rawSubdomain = (formData.get('subdomain') as string) || undefined
  const category = parseBusinessCategory(formData.get('category'))
  const acceptedTerms = formData.get('acceptedTerms') as string
  const useServiceTemplate = formData.get('useServiceTemplate') === 'true'

  if (acceptedTerms !== 'true') {
    throw new RegistrationError('Debes aceptar los términos y condiciones y la política de privacidad', 'VALIDATION')
  }

  if (!email || !password) {
    throw new RegistrationError('Email y contraseña son requeridos', 'VALIDATION')
  }

  const subdomainInput = rawSubdomain
    ? validateSubdomain(rawSubdomain)
    : null

  if (rawSubdomain && subdomainInput && !subdomainInput.valid) {
    throw new RegistrationError(subdomainInput.error!, 'VALIDATION')
  }

  // ── RECONCILIATION NOTE ──────────────────────────────────────────────────
  // Supabase Auth creates the user BEFORE the Prisma transaction runs.
  // If the Prisma transaction fails after Supabase succeeds, the auth user
  // exists in Supabase but has no Business in our DB.
  //
  // This is an inherent design tradeoff: Supabase Auth (external service)
  // cannot be wrapped in a Prisma transaction. We mitigate it as follows:
  //
  // 1. The Prisma $transaction is the innermost unit — all DB writes are
  //    atomic (User, Business, BusinessUser, Subscription, Services).
  // 2. If Prisma fails AFTER Supabase succeeds, the user will see the
  //    Supabase confirmation email but no dashboard access. On next login,
  //    the `getCurrentUserWithBusiness` function will find the Supabase user
  //    but no BusinessUser record. In that case, the dashboard redirects to
  //    /login. A future reconciliation endpoint or admin tool can:
  //    a) Detect orphan Supabase users (auth exists, no BusinessUser).
  //    b) Re-run createBusinessForUser or offer a recovery path.
  // 3. The most common failure points (duplicate subdomain, DB connection)
  //    are caught early in the transaction and surface clear errors.
  // 4. If SUPABASE_SERVICE_ROLE_KEY is configured, a future improvement
  //    could call supabaseAdmin.deleteUser() on Prisma failure for cleanup.
  //
  // For the beta, the risk is low because registration failures are
  // extremely rare with proper subdomain validation and the transaction
  // design. Orphan users can be resolved manually via the admin panel or
  // a one-time reconciliation script.
  // ──────────────────────────────────────────────────────────────────────────

  const supabase = await createClient()
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name },
    },
  })

  if (authError) {
    if (authError.message?.includes('already registered') || authError.message?.includes('already exists')) {
      throw new RegistrationError('Ya existe una cuenta con este email', 'EMAIL_TAKEN')
    }
    throw new RegistrationError('Error al crear la cuenta. Intenta de nuevo.', 'AUTH_ERROR')
  }

  if (!authData.user) {
    throw new RegistrationError('No se pudo crear el usuario. Intenta de nuevo.', 'AUTH_ERROR')
  }

  try {
    await createBusinessForUser({
      userId: authData.user.id,
      email,
      name: name || undefined,
      subdomain: subdomainInput?.sanitized,
      category,
      useServiceTemplate,
    })
  } catch (error) {
    if (error instanceof RegistrationError) {
      throw error
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const target = (error.meta?.target as string[]) || []
        if (target.includes('subdomain') || target.includes('slug')) {
          throw new RegistrationError('Este subdominio ya está en uso. Elige otro.', 'SUBDOMAIN_TAKEN')
        }
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      console.error('Registration DB error:', error)
    }
    throw new RegistrationError('Error al configurar tu cuenta. Intenta de nuevo o contacta soporte.', 'INTERNAL')
  }

  if (!authData.session) {
    return { requiresEmailConfirmation: true as const }
  }

  redirect('/dashboard')
}

/** El `redirect('/dashboard')` del final atraviesa el wrapper intacto:
 *  `action()` llama `unstable_rethrow` antes de clasificar el error. */
export const signUp = action(_signUp)


export async function signOut() {
  const supabase = await createClient()
  const { error } = await supabase.auth.signOut()
  if (error) {
    throw new Error(error.message)
  }
  redirect('/')
}

/** Login de clienta (y de cualquier persona) con Google. Reusa el flujo PKCE:
 *  Supabase redirige a /auth/callback, el middleware intercambia el code y
 *  redirige a `next`. Requiere el provider Google habilitado en Supabase. */
export async function signInWithGoogle(next: string | null) {
  const supabase = await createClient()
  const safeNext = sanitizeNext(next, '/mi')
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: getAppUrl(`/auth/callback?next=${encodeURIComponent(safeNext)}`) },
  })
  if (error || !data?.url) {
    // El form action descarta el valor de retorno — sin este redirect el error
    // sería un botón muerto. Se preserva `next` para reintentar.
    redirect(`/ingresar?error=oauth&next=${encodeURIComponent(safeNext)}`)
  }
  redirect(data.url)
}
