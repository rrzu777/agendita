import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { encryptSecret } from '@/lib/payments/encryption'
import { createHmac } from 'crypto'

function verifyState(state: string): { businessId: string; valid: boolean } {
  const parts = state.split(':')
  if (parts.length !== 4) {
    return { businessId: '', valid: false }
  }

  const [businessId, stateValue, expiresAtStr, signature] = parts
  const expiresAt = parseInt(expiresAtStr, 10)

  if (isNaN(expiresAt) || Date.now() > expiresAt) {
    return { businessId: businessId || '', valid: false }
  }

  const expectedSig = createHmac('sha256', process.env.ENCRYPTION_KEY || 'dev-secret')
    .update(`${businessId}:${stateValue}:${expiresAt}`)
    .digest('hex')

  if (!timingSafeEqualStr(signature, expectedSig)) {
    return { businessId: businessId || '', valid: false }
  }

  return { businessId, valid: true }
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    const errorDesc = url.searchParams.get('error_description') || error
    return NextResponse.redirect(
      new URL(`/dashboard/settings/payments?error=${encodeURIComponent(errorDesc)}`, request.url),
    )
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL('/dashboard/settings/payments?error=invalid_callback', request.url),
    )
  }

  const { businessId, valid } = verifyState(state)
  if (!valid || !businessId) {
    return NextResponse.redirect(
      new URL('/dashboard/settings/payments?error=invalid_state', request.url),
    )
  }

  const redirectUri = process.env.MERCADO_PAGO_REDIRECT_URI

  try {
    const tokenRes = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.MERCADO_PAGO_CLIENT_ID,
        client_secret: process.env.MERCADO_PAGO_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    })

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text()
      console.error('[MP OAuth] Token exchange failed:', errBody)
      return NextResponse.redirect(
        new URL('/dashboard/settings/payments?error=token_exchange_failed', request.url),
      )
    }

    const tokenData = await tokenRes.json() as {
      access_token: string
      refresh_token?: string
      public_key?: string
      expires_in?: number
      user_id?: number
    }

    const encryptedAccessToken = encryptSecret(tokenData.access_token)
    const encryptedRefreshToken = tokenData.refresh_token
      ? encryptSecret(tokenData.refresh_token)
      : null
    const encryptedPublicKey = tokenData.public_key
      ? encryptSecret(tokenData.public_key)
      : null

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null

    await prisma.paymentAccount.upsert({
      where: {
        businessId_provider: {
          businessId,
          provider: 'mercado_pago',
        },
      },
      create: {
        businessId,
        provider: 'mercado_pago',
        providerAccountId: tokenData.user_id ? String(tokenData.user_id) : null,
        accessTokenEncrypted: encryptedAccessToken,
        refreshTokenEncrypted: encryptedRefreshToken,
        publicKeyEncrypted: encryptedPublicKey,
        expiresAt,
        status: 'connected',
        connectedAt: new Date(),
      },
      update: {
        providerAccountId: tokenData.user_id ? String(tokenData.user_id) : null,
        accessTokenEncrypted: encryptedAccessToken,
        refreshTokenEncrypted: encryptedRefreshToken,
        publicKeyEncrypted: encryptedPublicKey,
        expiresAt,
        status: 'connected',
        connectedAt: new Date(),
        disconnectedAt: null,
      },
    })

    return NextResponse.redirect(
      new URL('/dashboard/settings/payments?success=connected', request.url),
    )
  } catch (e) {
    console.error('[MP OAuth] Unexpected error:', e)
    return NextResponse.redirect(
      new URL('/dashboard/settings/payments?error=unexpected', request.url),
    )
  }
}
