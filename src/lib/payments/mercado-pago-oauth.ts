import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import type { MercadoPagoEnvironment, PaymentAccountStatus, Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { decryptSecret, encryptSecret } from './encryption'
import { signState, verifyStateSignature } from './oauth-state'

const TOKEN_URL = 'https://api.mercadopago.com/oauth/token'
const REFRESH_SKEW_MS = 5 * 60 * 1000
const REQUEST_TIMEOUT_MS = 5_000
export const MP_OAUTH_PKCE_COOKIE = 'agendita_mp_oauth_pkce'

export type BusinessOAuthAccount = {
  id: string
  businessId: string
  environment: MercadoPagoEnvironment
  status: PaymentAccountStatus
  accessTokenEncrypted: string
  refreshTokenEncrypted: string | null
  expiresAt: Date | null
}

type TokenUpdate = Pick<BusinessOAuthAccount, 'accessTokenEncrypted' | 'refreshTokenEncrypted' | 'expiresAt'> & {
  lastRefreshAt: Date
}

export interface MercadoPagoOAuthRepository {
  findConnectedAccount(input: { businessId?: string; accountId?: string; environment: MercadoPagoEnvironment }): Promise<BusinessOAuthAccount | null>
  withAccountLock<T>(accountId: string, operation: (repository: MercadoPagoOAuthRepository) => Promise<T>): Promise<T>
  replaceTokens(accountId: string, update: TokenUpdate): Promise<boolean>
  expireAccount(accountId: string): Promise<boolean>
  queueExpiredNotification(account: BusinessOAuthAccount, effectiveDate: Date): Promise<void>
}

type OAuthFetch = typeof fetch

type TokenResponse = {
  accessToken: string
  refreshToken: string
  publicKey?: string
  expiresAt: Date
  providerAccountId?: string
}

export class MercadoPagoOAuthExpiredError extends Error {
  constructor() {
    super('La conexión con Mercado Pago expiró. Reconecta tu cuenta.')
    this.name = 'MercadoPagoOAuthExpiredError'
  }
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function createMercadoPagoOAuthState(input: {
  businessId: string
  environment: MercadoPagoEnvironment
  nonce: string
  expiresAt: Date
}): string {
  const payload = `${input.businessId}:${input.environment}:${input.nonce}:${input.expiresAt.getTime()}`
  return `${payload}:${signState(payload)}`
}

export function verifyMercadoPagoOAuthState(
  state: string,
  expectedEnvironment: MercadoPagoEnvironment,
  now = new Date(),
): { businessId: string; environment: MercadoPagoEnvironment; nonce: string; expiresAt: Date } | null {
  const parts = state.split(':')
  if (parts.length !== 5) return null
  const [businessId, environment, nonce, expiresAtRaw, signature] = parts
  if (!businessId || !nonce || environment !== expectedEnvironment) return null
  if (environment !== 'sandbox' && environment !== 'production') return null
  const expiresAtMs = Number(expiresAtRaw)
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= now.getTime()) return null
  const payload = `${businessId}:${environment}:${nonce}:${expiresAtRaw}`
  if (!verifyStateSignature(payload, signature)) return null
  return { businessId, environment, nonce, expiresAt: new Date(expiresAtMs) }
}

function oauthBody(
  environment: MercadoPagoEnvironment,
  values: Record<string, string>,
): Record<string, string | boolean> {
  return environment === 'sandbox' ? { ...values, test_token: true } : values
}

async function requestToken(
  body: Record<string, string | boolean>,
  fetchImpl: OAuthFetch,
): Promise<{ response: Response; json: unknown }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const contentType = response.headers.get('content-type') ?? ''
    const json = contentType.toLowerCase().includes('application/json')
      ? await response.json().catch(() => null)
      : null
    return { response, json }
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeTokenResponse(json: unknown, now: Date): TokenResponse | null {
  if (!json || typeof json !== 'object') return null
  const value = json as Record<string, unknown>
  if (typeof value.access_token !== 'string' || value.access_token.length === 0) return null
  if (typeof value.refresh_token !== 'string' || value.refresh_token.length === 0) return null
  if (typeof value.expires_in !== 'number' || !Number.isFinite(value.expires_in) || value.expires_in <= 0) return null
  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    expiresAt: new Date(now.getTime() + value.expires_in * 1000),
    ...(typeof value.public_key === 'string' && value.public_key ? { publicKey: value.public_key } : {}),
    ...(typeof value.user_id === 'number' || typeof value.user_id === 'string'
      ? { providerAccountId: String(value.user_id) }
      : {}),
  }
}

export async function exchangeAuthorizationCode(input: {
  environment: MercadoPagoEnvironment
  clientId: string
  clientSecret: string
  redirectUri: string
  code: string
  codeVerifier: string
}, dependencies: { fetch?: OAuthFetch; now?: () => Date } = {}): Promise<TokenResponse> {
  const { response, json } = await requestToken(oauthBody(input.environment, {
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    grant_type: 'authorization_code',
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  }), dependencies.fetch ?? fetch)
  if (!response.ok) throw new Error(`Mercado Pago OAuth token exchange failed (${response.status}).`)
  const token = normalizeTokenResponse(json, dependencies.now?.() ?? new Date())
  if (!token) throw new Error('Mercado Pago OAuth returned an invalid token response.')
  return token
}

function runtimeRepository(client: PrismaClient | Prisma.TransactionClient = prisma): MercadoPagoOAuthRepository {
  return {
    async findConnectedAccount({ businessId, accountId, environment }) {
      const row = await client.paymentAccount.findFirst({
        where: {
          ...(businessId ? { businessId } : {}),
          ...(accountId ? { id: accountId } : {}),
          provider: 'mercado_pago', environment, status: 'connected',
        },
        select: {
          id: true, businessId: true, environment: true, status: true,
          accessTokenEncrypted: true, refreshTokenEncrypted: true, expiresAt: true,
        },
      })
      return row?.environment ? row as BusinessOAuthAccount : null
    },
    async withAccountLock<T>(accountId: string, operation: (repository: MercadoPagoOAuthRepository) => Promise<T>) {
      if ('$transaction' in client) {
        return (client as PrismaClient).$transaction(async (tx) => {
          // Put the void-returning lock function in FROM and only project a
          // boolean. Prisma cannot deserialize PostgreSQL's `void` type.
          await tx.$queryRaw`SELECT true AS acquired FROM pg_advisory_xact_lock(hashtext(${accountId}))`
          return operation(runtimeRepository(tx))
        }, { timeout: REQUEST_TIMEOUT_MS + 5_000 })
      }
      return operation(runtimeRepository(client))
    },
    async replaceTokens(accountId, update) {
      const result = await client.paymentAccount.updateMany({
        where: { id: accountId, provider: 'mercado_pago', status: 'connected' },
        data: update,
      })
      return result.count === 1
    },
    async expireAccount(accountId) {
      const result = await client.paymentAccount.updateMany({
        where: { id: accountId, provider: 'mercado_pago', status: 'connected' },
        data: { status: 'expired' },
      })
      return result.count === 1
    },
    async queueExpiredNotification(account, effectiveDate) {
      // Lazy import keeps the generic payment factory independent from the
      // email/template graph until an OAuth connection actually expires.
      const { queueSubscriptionNotification } = await import('@/lib/notifications/subscriptions')
      const subscription = await client.businessSubscription.findFirst({
        where: { businessId: account.businessId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      })
      if (!subscription) {
        throw new Error('OAuth expiration notification requires a business subscription.')
      }
      await queueSubscriptionNotification('subscription_oauth_expired', {
        businessId: account.businessId,
        subscriptionId: subscription.id,
        effectiveDate,
        eventAt: effectiveDate,
        eventId: `${account.environment}:${effectiveDate.toISOString()}`,
      }, { prisma: client, now: () => effectiveDate })
    },
  }
}

function tokenIsFresh(account: BusinessOAuthAccount, now: Date): boolean {
  return account.expiresAt !== null && account.expiresAt.getTime() - now.getTime() > REFRESH_SKEW_MS
}

export async function refreshBusinessAccessToken(
  account: BusinessOAuthAccount,
  dependencies: {
    repository?: MercadoPagoOAuthRepository
    fetch?: OAuthFetch
    now?: () => Date
    clientId?: string
    clientSecret?: string
  } = {},
): Promise<string> {
  const repository = dependencies.repository ?? runtimeRepository()
  const now = dependencies.now?.() ?? new Date()
  if (!account.refreshTokenEncrypted) throw new MercadoPagoOAuthExpiredError()
  let refreshToken: string
  try { refreshToken = decryptSecret(account.refreshTokenEncrypted) } catch { throw new MercadoPagoOAuthExpiredError() }
  const clientId = dependencies.clientId ?? process.env.MERCADO_PAGO_CLIENT_ID
  const clientSecret = dependencies.clientSecret ?? process.env.MERCADO_PAGO_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Mercado Pago OAuth is not configured.')

  const { response, json } = await requestToken(oauthBody(account.environment, {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }), dependencies.fetch ?? fetch)

  if (!response.ok) {
    const code = json && typeof json === 'object' ? (json as Record<string, unknown>).error : null
    if (response.status === 400 && code === 'invalid_grant') {
      if (await repository.expireAccount(account.id)) {
        await repository.queueExpiredNotification(account, now)
      }
      throw new MercadoPagoOAuthExpiredError()
    }
    throw new Error(`Mercado Pago OAuth token refresh failed (${response.status}).`)
  }
  const token = normalizeTokenResponse(json, now)
  if (!token) throw new Error('Mercado Pago OAuth returned an invalid token response.')
  const updated = await repository.replaceTokens(account.id, {
    accessTokenEncrypted: encryptSecret(token.accessToken),
    refreshTokenEncrypted: encryptSecret(token.refreshToken),
    expiresAt: token.expiresAt,
    lastRefreshAt: now,
  })
  if (!updated) throw new Error('Mercado Pago OAuth token refresh conflicted.')
  return token.accessToken
}

export async function getValidBusinessAccessToken(
  businessId: string,
  environment: MercadoPagoEnvironment,
  dependencies: {
    repository?: MercadoPagoOAuthRepository
    fetch?: OAuthFetch
    now?: () => Date
  } = {},
): Promise<string> {
  const repository = dependencies.repository ?? runtimeRepository()
  const now = dependencies.now?.() ?? new Date()
  const account = await repository.findConnectedAccount({ businessId, environment })
  if (!account) throw new Error('Este negocio no tiene Mercado Pago conectado.')
  if (tokenIsFresh(account, now)) return decryptSecret(account.accessTokenEncrypted)

  const result = await repository.withAccountLock(account.id, async (lockedRepository) => {
    const current = await lockedRepository.findConnectedAccount({ accountId: account.id, environment })
    if (!current) throw new MercadoPagoOAuthExpiredError()
    const lockedNow = dependencies.now?.() ?? new Date()
    if (tokenIsFresh(current, lockedNow)) return decryptSecret(current.accessTokenEncrypted)
    try {
      return await refreshBusinessAccessToken(current, {
        repository: lockedRepository,
        fetch: dependencies.fetch,
        now: () => lockedNow,
      })
    } catch (error) {
      // An invalid_grant changes status and queues its outbox record inside
      // this same transaction. Return a sentinel so the transaction commits;
      // throwing here would silently roll both durable effects back.
      if (error instanceof MercadoPagoOAuthExpiredError) return null
      throw error
    }
  })
  if (result === null) throw new MercadoPagoOAuthExpiredError()
  return result
}

export function encryptOAuthTokenResponse(token: TokenResponse) {
  return {
    providerAccountId: token.providerAccountId ?? null,
    accessTokenEncrypted: encryptSecret(token.accessToken),
    refreshTokenEncrypted: encryptSecret(token.refreshToken),
    publicKeyEncrypted: token.publicKey ? encryptSecret(token.publicKey) : null,
    expiresAt: token.expiresAt,
  }
}
