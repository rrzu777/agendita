import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import type { MercadoPagoEnvironment, PaymentAccountStatus, Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { decryptSecret, encryptSecret } from './encryption'
import { signState, verifyStateSignature } from './oauth-state'

const TOKEN_URL = 'https://api.mercadopago.com/oauth/token'
const REFRESH_SKEW_MS = 5 * 60 * 1000
const REQUEST_TIMEOUT_MS = 5_000
const REFRESH_LEASE_MS = 10_000
const REFRESH_WAIT_MS = [50, 100, 250, 500, 1_000, 2_000, 2_000] as const
const MAX_ACTIVE_OAUTH_ATTEMPTS = 5

export type BusinessOAuthAccount = {
  id: string
  businessId: string
  environment: MercadoPagoEnvironment
  status: PaymentAccountStatus
  providerAccountId: string | null
  accessTokenEncrypted: string
  refreshTokenEncrypted: string | null
  expiresAt: Date | null
  refreshLeaseToken: string | null
  refreshLeaseExpiresAt: Date | null
  tokenVersion: number
}

type TokenUpdate = Pick<BusinessOAuthAccount, 'accessTokenEncrypted' | 'refreshTokenEncrypted' | 'expiresAt'> & {
  lastRefreshAt: Date
}

export interface MercadoPagoOAuthRepository {
  findConnectedAccount(input: { businessId?: string; accountId?: string; environment: MercadoPagoEnvironment }): Promise<BusinessOAuthAccount | null>
  claimRefresh(account: BusinessOAuthAccount, claimToken: string, now: Date, leaseExpiresAt: Date): Promise<boolean>
  releaseRefreshClaim(account: BusinessOAuthAccount, claimToken: string): Promise<void>
  replaceTokens(account: BusinessOAuthAccount, claimToken: string, update: TokenUpdate): Promise<boolean>
  expireClaimAndQueue(account: BusinessOAuthAccount, claimToken: string, effectiveDate: Date): Promise<boolean>
}

type OAuthFetch = typeof fetch

type TokenResponse = {
  accessToken: string
  refreshToken: string
  publicKey?: string
  expiresAt: Date
  providerAccountId: string
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

export function hashMercadoPagoOAuthNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex')
}

export async function persistMercadoPagoOAuthAttempt(input: {
  businessId: string
  environment: MercadoPagoEnvironment
  nonce: string
  verifier: string
  userId: string
  expiresAt: Date
  now?: Date
}, client: PrismaClient = prisma): Promise<void> {
  const now = input.now ?? new Date()
  await client.$transaction(async (tx) => {
    const lockKey = `mp-oauth-attempt:${input.businessId}:${input.environment}:${input.userId}`
    await tx.$queryRaw`SELECT true AS acquired FROM pg_advisory_xact_lock(hashtext(${lockKey}))`
    await tx.mercadoPagoOAuthAttempt.deleteMany({
      where: {
        businessId: input.businessId, environment: input.environment,
        createdByUserId: input.userId,
        OR: [{ expiresAt: { lte: now } }, { consumedAt: { not: null } }],
      },
    })
    const active = await tx.mercadoPagoOAuthAttempt.findMany({
      where: {
        businessId: input.businessId, environment: input.environment,
        createdByUserId: input.userId, consumedAt: null, expiresAt: { gt: now },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    })
    const removeCount = Math.max(0, active.length - MAX_ACTIVE_OAUTH_ATTEMPTS + 1)
    if (removeCount > 0) {
      await tx.mercadoPagoOAuthAttempt.deleteMany({
        where: { id: { in: active.slice(0, removeCount).map(({ id }) => id) } },
      })
    }
    await tx.mercadoPagoOAuthAttempt.create({
      data: {
        businessId: input.businessId, environment: input.environment,
        nonceHash: hashMercadoPagoOAuthNonce(input.nonce),
        verifierEncrypted: encryptSecret(input.verifier),
        createdByUserId: input.userId, expiresAt: input.expiresAt,
      },
    })
  })
}

export async function consumeMercadoPagoOAuthAttempt(input: {
  businessId: string
  environment: MercadoPagoEnvironment
  nonce: string
  userId: string
  now?: Date
}, client: PrismaClient = prisma): Promise<string | null> {
  const now = input.now ?? new Date()
  const attempt = await client.$transaction(async (tx) => {
    const found = await tx.mercadoPagoOAuthAttempt.findFirst({
      where: {
        nonceHash: hashMercadoPagoOAuthNonce(input.nonce),
        businessId: input.businessId,
        environment: input.environment,
        createdByUserId: input.userId,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true, verifierEncrypted: true },
    })
    if (!found) return null
    const consumed = await tx.mercadoPagoOAuthAttempt.updateMany({
      where: { id: found.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    })
    return consumed.count === 1 ? found : null
  })
  if (!attempt) return null
  try { return decryptSecret(attempt.verifierEncrypted) } catch { return null }
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
  const numericUserId = typeof value.user_id === 'number'
    ? value.user_id
    : typeof value.user_id === 'string' && /^[1-9][0-9]*$/.test(value.user_id)
      ? Number(value.user_id)
      : NaN
  if (!Number.isSafeInteger(numericUserId) || numericUserId <= 0) return null
  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    expiresAt: new Date(now.getTime() + value.expires_in * 1000),
    ...(typeof value.public_key === 'string' && value.public_key ? { publicKey: value.public_key } : {}),
    providerAccountId: String(numericUserId),
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
          providerAccountId: true, accessTokenEncrypted: true,
          refreshTokenEncrypted: true, expiresAt: true, refreshLeaseToken: true,
          refreshLeaseExpiresAt: true, tokenVersion: true,
        },
      })
      return row?.environment ? row as BusinessOAuthAccount : null
    },
    async claimRefresh(account, claimToken, now, leaseExpiresAt) {
      const result = await client.paymentAccount.updateMany({
        where: {
          id: account.id, provider: 'mercado_pago', environment: account.environment,
          status: 'connected', providerAccountId: account.providerAccountId,
          tokenVersion: account.tokenVersion,
          OR: [{ refreshLeaseToken: null }, { refreshLeaseExpiresAt: { lte: now } }],
        },
        data: { refreshLeaseToken: claimToken, refreshLeaseExpiresAt: leaseExpiresAt },
      })
      return result.count === 1
    },
    async releaseRefreshClaim(account, claimToken) {
      await client.paymentAccount.updateMany({
        where: { id: account.id, tokenVersion: account.tokenVersion, refreshLeaseToken: claimToken },
        data: { refreshLeaseToken: null, refreshLeaseExpiresAt: null },
      })
    },
    async replaceTokens(account, claimToken, update) {
      const result = await client.paymentAccount.updateMany({
        where: {
          id: account.id, provider: 'mercado_pago', environment: account.environment,
          status: 'connected', providerAccountId: account.providerAccountId,
          tokenVersion: account.tokenVersion, refreshLeaseToken: claimToken,
        },
        data: {
          ...update, tokenVersion: { increment: 1 },
          refreshLeaseToken: null, refreshLeaseExpiresAt: null,
        },
      })
      return result.count === 1
    },
    async expireClaimAndQueue(account, claimToken, effectiveDate) {
      if (!('$transaction' in client)) throw new Error('OAuth expiration requires a transaction-capable repository.')
      const { queueSubscriptionNotification } = await import('@/lib/notifications/subscriptions')
      return (client as PrismaClient).$transaction(async (tx) => {
        const result = await tx.paymentAccount.updateMany({
          where: {
            id: account.id, provider: 'mercado_pago', environment: account.environment,
            status: 'connected', providerAccountId: account.providerAccountId,
            tokenVersion: account.tokenVersion, refreshLeaseToken: claimToken,
          },
          data: {
            status: 'expired', refreshLeaseToken: null, refreshLeaseExpiresAt: null,
            tokenVersion: { increment: 1 },
          },
        })
        if (result.count !== 1) return false
        const subscription = await tx.businessSubscription.findFirst({
          where: { businessId: account.businessId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true },
        })
        if (!subscription) throw new Error('OAuth expiration notification requires a business subscription.')
        await queueSubscriptionNotification('subscription_oauth_expired', {
          businessId: account.businessId, subscriptionId: subscription.id,
          effectiveDate, eventAt: effectiveDate,
          eventId: `${account.environment}:${account.tokenVersion}`,
        }, { prisma: tx, now: () => effectiveDate })
        return true
      })
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
    sleep?: (milliseconds: number) => Promise<void>
  } = {},
): Promise<string> {
  const repository = dependencies.repository ?? runtimeRepository()
  const getNow = dependencies.now ?? (() => new Date())
  const sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const clientId = dependencies.clientId ?? process.env.MERCADO_PAGO_CLIENT_ID
  const clientSecret = dependencies.clientSecret ?? process.env.MERCADO_PAGO_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Mercado Pago OAuth is not configured.')
  let current = account
  for (let attempt = 0; attempt <= REFRESH_WAIT_MS.length; attempt += 1) {
    if (!current.providerAccountId || !/^[1-9][0-9]*$/.test(current.providerAccountId)) {
      throw new MercadoPagoOAuthExpiredError()
    }
    const now = getNow()
    if (tokenIsFresh(current, now)) return decryptSecret(current.accessTokenEncrypted)
    const claimToken = randomBytes(24).toString('base64url')
    const claimed = await repository.claimRefresh(
      current, claimToken, now, new Date(now.getTime() + REFRESH_LEASE_MS),
    )
    if (claimed) {
      if (!current.refreshTokenEncrypted) {
        await repository.releaseRefreshClaim(current, claimToken)
        throw new MercadoPagoOAuthExpiredError()
      }
      let refreshToken: string
      try { refreshToken = decryptSecret(current.refreshTokenEncrypted) } catch {
        await repository.releaseRefreshClaim(current, claimToken)
        throw new MercadoPagoOAuthExpiredError()
      }
      try {
        const { response, json } = await requestToken(oauthBody(current.environment, {
          client_id: clientId, client_secret: clientSecret,
          grant_type: 'refresh_token', refresh_token: refreshToken,
        }), dependencies.fetch ?? fetch)
        if (!response.ok) {
          const code = json && typeof json === 'object' ? (json as Record<string, unknown>).error : null
          if (response.status === 400 && code === 'invalid_grant') {
            const expired = await repository.expireClaimAndQueue(current, claimToken, now)
            if (expired) throw new MercadoPagoOAuthExpiredError()
            const winner = await repository.findConnectedAccount({ accountId: current.id, environment: current.environment })
            if (winner && tokenIsFresh(winner, getNow())) return decryptSecret(winner.accessTokenEncrypted)
            throw new Error('Mercado Pago OAuth token refresh conflicted.')
          }
          await repository.releaseRefreshClaim(current, claimToken)
          throw new Error(`Mercado Pago OAuth token refresh failed (${response.status}).`)
        }
        const token = normalizeTokenResponse(json, now)
        if (!token) {
          await repository.releaseRefreshClaim(current, claimToken)
          throw new Error('Mercado Pago OAuth returned an invalid token response.')
        }
        if (token.providerAccountId !== current.providerAccountId) {
          await repository.releaseRefreshClaim(current, claimToken)
          throw new Error('Mercado Pago OAuth seller mismatch.')
        }
        const updated = await repository.replaceTokens(current, claimToken, {
          accessTokenEncrypted: encryptSecret(token.accessToken),
          refreshTokenEncrypted: encryptSecret(token.refreshToken),
          expiresAt: token.expiresAt, lastRefreshAt: now,
        })
        if (updated) return token.accessToken
        const winner = await repository.findConnectedAccount({ accountId: current.id, environment: current.environment })
        if (winner && tokenIsFresh(winner, getNow())) return decryptSecret(winner.accessTokenEncrypted)
        throw new Error('Mercado Pago OAuth token refresh conflicted.')
      } catch (error) {
        if (!(error instanceof MercadoPagoOAuthExpiredError)) {
          await repository.releaseRefreshClaim(current, claimToken)
        }
        throw error
      }
    }
    if (attempt === REFRESH_WAIT_MS.length) break
    await sleep(REFRESH_WAIT_MS[attempt])
    const reread = await repository.findConnectedAccount({ accountId: current.id, environment: current.environment })
    if (!reread) throw new MercadoPagoOAuthExpiredError()
    current = reread
  }
  throw new Error('Mercado Pago OAuth token refresh is already in progress.')
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

  return refreshBusinessAccessToken(account, {
    repository, fetch: dependencies.fetch, now: dependencies.now,
  })
}

export function encryptOAuthTokenResponse(token: TokenResponse) {
  return {
    providerAccountId: token.providerAccountId,
    accessTokenEncrypted: encryptSecret(token.accessToken),
    refreshTokenEncrypted: encryptSecret(token.refreshToken),
    publicKeyEncrypted: token.publicKey ? encryptSecret(token.publicKey) : null,
    expiresAt: token.expiresAt,
  }
}
