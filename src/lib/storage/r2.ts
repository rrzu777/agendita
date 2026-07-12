import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { logger } from '@/lib/logger'

export interface ProofStorage {
  presignUpload(key: string, contentType: string): Promise<string>
  presignDownload(key: string, contentType: string): Promise<string>
  head(key: string): Promise<{ contentLength: number; contentType: string | null } | null>
}

interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

function readConfig(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null
  return { accountId, accessKeyId, secretAccessKey, bucket }
}

/** never-throws: para gatear la feature en UI y actions. */
export function isProofUploadAvailable(): boolean {
  return readConfig() !== null
}

/** null si R2 no está configurado (mirror de getResend()). */
export function getProofStorage(): ProofStorage | null {
  const cfg = readConfig()
  if (!cfg) return null
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  })
  return {
    async presignUpload(key, contentType) {
      return getSignedUrl(client, new PutObjectCommand({ Bucket: cfg.bucket, Key: key, ContentType: contentType }), { expiresIn: 120 })
    },
    async presignDownload(key, contentType) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          ResponseContentType: contentType,
          ResponseContentDisposition: 'inline; filename="comprobante"',
        }),
        { expiresIn: 60 },
      )
    },
    async head(key) {
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }))
        return { contentLength: r.ContentLength ?? 0, contentType: r.ContentType ?? null }
      } catch (e) {
        // NotFound / 404 → el objeto no existe. Cualquier otro error también
        // se trata como "no verificable" (el caller rechaza el declare).
        logger.warn('r2.head.failed', 'r2 head failed', {
          metadata: { key, error: e instanceof Error ? e.message : String(e) },
        })
        return null
      }
    },
  }
}
