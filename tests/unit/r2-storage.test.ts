import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const ORIGINAL = { ...process.env }
afterEach(() => { process.env = { ...ORIGINAL }; vi.resetModules() })
beforeEach(() => {
  for (const key of [
    'R2_ACCOUNT_ID',
    'R2_ENDPOINT',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
  ]) {
    delete process.env[key]
  }
  vi.resetModules()
})

function setR2Credentials() {
  process.env.R2_ACCESS_KEY_ID = 'ak'
  process.env.R2_SECRET_ACCESS_KEY = 'sk'
  process.env.R2_BUCKET = 'bucket'
}

describe('isObjectStorageAvailable', () => {
  it('false si falta alguna env de R2', async () => {
    delete process.env.R2_ACCOUNT_ID
    const { isObjectStorageAvailable } = await import('@/lib/storage/r2')
    expect(isObjectStorageAvailable()).toBe(false)
  })
  it('true con las 4 envs presentes', async () => {
    process.env.R2_ACCOUNT_ID = 'acct'
    setR2Credentials()
    const { isObjectStorageAvailable } = await import('@/lib/storage/r2')
    expect(isObjectStorageAvailable()).toBe(true)
  })
  it('acepta el endpoint S3 oficial de Cloudflare como alternativa al account ID', async () => {
    process.env.R2_ENDPOINT =
      'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com'
    setR2Credentials()
    const { isObjectStorageAvailable } = await import('@/lib/storage/r2')
    expect(isObjectStorageAvailable()).toBe(true)
  })
  it('acepta un endpoint oficial con jurisdicción de Cloudflare R2', async () => {
    process.env.R2_ENDPOINT =
      'https://0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com'
    setR2Credentials()
    const { isObjectStorageAvailable } = await import('@/lib/storage/r2')
    expect(isObjectStorageAvailable()).toBe(true)
  })
  it.each([
    'https://evil.example',
    'http://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
    'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/path',
    'https://user:pass@0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
  ])('rechaza un endpoint R2 no canónico: %s', async (endpoint) => {
    process.env.R2_ENDPOINT = endpoint
    setR2Credentials()
    const { isObjectStorageAvailable } = await import('@/lib/storage/r2')
    expect(isObjectStorageAvailable()).toBe(false)
  })
  it('getObjectStorage devuelve null si R2 no está configurado', async () => {
    delete process.env.R2_BUCKET
    const { getObjectStorage } = await import('@/lib/storage/r2')
    expect(getObjectStorage()).toBeNull()
  })
})

describe('ObjectStorage presign', () => {
  it('presignUpload delega en getSignedUrl con PutObjectCommand', async () => {
    process.env.R2_ACCOUNT_ID = 'acct'
    setR2Credentials()
    const getSignedUrl = vi.fn().mockResolvedValue('https://signed.example/put')
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl }))
    const { getObjectStorage } = await import('@/lib/storage/r2')
    const url = await getObjectStorage()!.presignUpload('proofs/b/k/deposit', 'image/png')
    expect(url).toBe('https://signed.example/put')
    expect(getSignedUrl).toHaveBeenCalledOnce()
  })
})
