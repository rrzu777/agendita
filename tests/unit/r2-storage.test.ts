import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const ORIGINAL = { ...process.env }
afterEach(() => { process.env = { ...ORIGINAL }; vi.resetModules() })
beforeEach(() => vi.resetModules())

describe('isObjectStorageAvailable', () => {
  it('false si falta alguna env de R2', async () => {
    delete process.env.R2_ACCOUNT_ID
    const { isObjectStorageAvailable } = await import('@/lib/storage/r2')
    expect(isObjectStorageAvailable()).toBe(false)
  })
  it('true con las 4 envs presentes', async () => {
    process.env.R2_ACCOUNT_ID = 'acct'
    process.env.R2_ACCESS_KEY_ID = 'ak'
    process.env.R2_SECRET_ACCESS_KEY = 'sk'
    process.env.R2_BUCKET = 'bucket'
    const { isObjectStorageAvailable } = await import('@/lib/storage/r2')
    expect(isObjectStorageAvailable()).toBe(true)
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
    process.env.R2_ACCESS_KEY_ID = 'ak'
    process.env.R2_SECRET_ACCESS_KEY = 'sk'
    process.env.R2_BUCKET = 'bucket'
    const getSignedUrl = vi.fn().mockResolvedValue('https://signed.example/put')
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl }))
    const { getObjectStorage } = await import('@/lib/storage/r2')
    const url = await getObjectStorage()!.presignUpload('proofs/b/k/deposit', 'image/png')
    expect(url).toBe('https://signed.example/put')
    expect(getSignedUrl).toHaveBeenCalledOnce()
  })
})
