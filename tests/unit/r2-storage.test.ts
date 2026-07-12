import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const ORIGINAL = { ...process.env }
afterEach(() => { process.env = { ...ORIGINAL }; vi.resetModules() })
beforeEach(() => vi.resetModules())

describe('isProofUploadAvailable', () => {
  it('false si falta alguna env de R2', async () => {
    delete process.env.R2_ACCOUNT_ID
    const { isProofUploadAvailable } = await import('@/lib/storage/r2')
    expect(isProofUploadAvailable()).toBe(false)
  })
  it('true con las 4 envs presentes', async () => {
    process.env.R2_ACCOUNT_ID = 'acct'
    process.env.R2_ACCESS_KEY_ID = 'ak'
    process.env.R2_SECRET_ACCESS_KEY = 'sk'
    process.env.R2_BUCKET = 'bucket'
    const { isProofUploadAvailable } = await import('@/lib/storage/r2')
    expect(isProofUploadAvailable()).toBe(true)
  })
  it('getProofStorage devuelve null si R2 no está configurado', async () => {
    delete process.env.R2_BUCKET
    const { getProofStorage } = await import('@/lib/storage/r2')
    expect(getProofStorage()).toBeNull()
  })
})

describe('ProofStorage presign', () => {
  it('presignUpload delega en getSignedUrl con PutObjectCommand', async () => {
    process.env.R2_ACCOUNT_ID = 'acct'
    process.env.R2_ACCESS_KEY_ID = 'ak'
    process.env.R2_SECRET_ACCESS_KEY = 'sk'
    process.env.R2_BUCKET = 'bucket'
    const getSignedUrl = vi.fn().mockResolvedValue('https://signed.example/put')
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl }))
    const { getProofStorage } = await import('@/lib/storage/r2')
    const url = await getProofStorage()!.presignUpload('proofs/b/k/deposit', 'image/png')
    expect(url).toBe('https://signed.example/put')
    expect(getSignedUrl).toHaveBeenCalledOnce()
  })
})
