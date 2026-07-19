import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Hybrid de auth:
//  - getCurrentUser valida el JWT LOCALMENTE (getClaims, firma ECC vía jose) —
//    hot path del dashboard, sin round-trip. NO expone email_confirmed_at
//    (el JWT solo trae user_metadata.email_verified, que es escribible por el
//    usuario y por eso NO confiable, ver link.ts).
//  - getConfirmedSessionUser valida REMOTO (getUser) para obtener el
//    email_confirmed_at confiable seteado server-side por Supabase; solo lo usan
//    los gates de vinculación (/mi y reserva), flujos de baja frecuencia.
const getClaims = vi.fn()
const getUser = vi.fn()
const getSession = vi.fn()

vi.mock('next/headers', () => ({ headers: vi.fn(() => ({ get: () => null })) }))
vi.mock('@/lib/db', () => ({
  prisma: { user: { findUnique: vi.fn() }, businessUser: { findFirst: vi.fn() } },
}))
vi.mock('@/lib/auth/e2e-bypass', () => ({ validateE2EHeaders: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/auth/middleware', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getClaims: (...a: unknown[]) => getClaims(...a),
      getUser: (...a: unknown[]) => getUser(...a),
      getSession: (...a: unknown[]) => getSession(...a),
    },
  })),
}))

async function load() {
  return import('@/lib/auth/user')
}

describe('getCurrentUser — validación local del JWT (getClaims)', () => {
  beforeEach(() => {
    vi.resetModules()
    getClaims.mockReset()
    getUser.mockReset()
    getSession.mockReset()
  })

  it('mapea los claims del JWT a un user sin round-trip remoto a getUser', async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: 'u-1', email: 'ana@negocio.cl', user_metadata: { name: 'Ana' } } },
      error: null,
    })
    const { getCurrentUser } = await load()
    const user = await getCurrentUser()
    expect(user).not.toBeNull()
    expect(user!.id).toBe('u-1')
    expect(user!.email).toBe('ana@negocio.cl')
    expect(user!.user_metadata.name).toBe('Ana')
    expect(getUser).not.toHaveBeenCalled()
  })

  it('NO setea email_confirmed_at aunque el JWT diga email_verified:true (señal untrusted)', async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: 'u-2', email: 'x@y.cl', user_metadata: { email_verified: true } } },
      error: null,
    })
    const { getCurrentUser } = await load()
    const user = await getCurrentUser()
    // Laundering de user_metadata.email_verified → email_confirmed_at sería
    // explotable (link.ts). getCurrentUser nunca lo emite.
    expect(user!.email_confirmed_at).toBeFalsy()
  })

  it('devuelve null cuando getClaims falla o no hay claims', async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error('invalid jwt') })
    const { getCurrentUser } = await load()
    expect(await getCurrentUser()).toBeNull()
    expect(getUser).not.toHaveBeenCalled()
  })
})

describe('getConfirmedSessionUser — confirmación de email CONFIABLE (getUser remoto)', () => {
  beforeEach(() => {
    vi.resetModules()
    getClaims.mockReset()
    getUser.mockReset()
    getSession.mockReset()
  })

  it('valida remoto y devuelve el email_confirmed_at seteado por Supabase', async () => {
    getUser.mockResolvedValue({
      data: {
        user: {
          id: 'u-3',
          email: 'verificada@negocio.cl',
          email_confirmed_at: '2026-01-01T00:00:00.000Z',
          user_metadata: {},
        },
      },
      error: null,
    })
    const { getConfirmedSessionUser } = await load()
    const user = await getConfirmedSessionUser()
    expect(user!.id).toBe('u-3')
    expect(user!.email_confirmed_at).toBe('2026-01-01T00:00:00.000Z')
    expect(getUser).toHaveBeenCalled()
  })

  it('devuelve null cuando getUser falla', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error('revoked') })
    const { getConfirmedSessionUser } = await load()
    expect(await getConfirmedSessionUser()).toBeNull()
  })
})

// Autorización de admin de plataforma: la superficie de mayor privilegio NO puede
// depender del JWT local (una sesión revocada seguiría válida ~1h). Estos helpers
// validan REMOTO (getUser) vía getConfirmedSessionUser + isPlatformAdmin.
describe('admin de plataforma — validación REMOTA (getUser), no JWT local', () => {
  beforeEach(() => {
    vi.resetModules()
    getClaims.mockReset()
    getUser.mockReset()
    getSession.mockReset()
    vi.stubEnv('PLATFORM_ADMIN_EMAILS', 'jefa@agendita.cl')
  })
  afterEach(() => vi.unstubAllEnvs())

  function mockSessionEmail(email: string | null) {
    getUser.mockResolvedValue(
      email
        ? { data: { user: { id: 'u-adm', email, user_metadata: {} } }, error: null }
        : { data: { user: null }, error: new Error('sin sesión') },
    )
  }

  it('getPlatformAdminUser devuelve el user si el email es admin — vía getUser remoto, sin getClaims', async () => {
    mockSessionEmail('jefa@agendita.cl')
    const { getPlatformAdminUser } = await load()
    const user = await getPlatformAdminUser()
    expect(user!.id).toBe('u-adm')
    expect(getUser).toHaveBeenCalled()
    expect(getClaims).not.toHaveBeenCalled()
  })

  it('getPlatformAdminUser devuelve null si el email NO es admin', async () => {
    mockSessionEmail('cualquiera@negocio.cl')
    const { getPlatformAdminUser } = await load()
    expect(await getPlatformAdminUser()).toBeNull()
  })

  it('getPlatformAdminUser devuelve null sin sesión', async () => {
    mockSessionEmail(null)
    const { getPlatformAdminUser } = await load()
    expect(await getPlatformAdminUser()).toBeNull()
  })

  it('requirePlatformAdminUser devuelve el user si es admin', async () => {
    mockSessionEmail('jefa@agendita.cl')
    const { requirePlatformAdminUser } = await load()
    const user = await requirePlatformAdminUser()
    expect(user.email).toBe('jefa@agendita.cl')
    expect(getUser).toHaveBeenCalled()
  })

  it('requirePlatformAdminUser lanza si NO es admin', async () => {
    mockSessionEmail('cualquiera@negocio.cl')
    const { requirePlatformAdminUser } = await load()
    await expect(requirePlatformAdminUser()).rejects.toThrow(/permisos/i)
  })

  it('requirePlatformAdminUser lanza sin sesión', async () => {
    mockSessionEmail(null)
    const { requirePlatformAdminUser } = await load()
    await expect(requirePlatformAdminUser()).rejects.toThrow(/permisos/i)
  })
})
