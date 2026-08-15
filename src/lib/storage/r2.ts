import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { logger } from '@/lib/logger'
import { resolveR2Endpoint } from '@/lib/storage/r2-config'

// Cliente único del bucket privado. Nació para los comprobantes de transferencia
// y hoy también guarda las fotos de la ficha, por eso el nombre es genérico: lo
// que cambia entre features es el prefijo de la key (lib/storage/proof.ts,
// lib/storage/photos.ts), no el transporte.
export interface ObjectStorage {
  presignUpload(key: string, contentType: string): Promise<string>
  /** `filename` es OBLIGATORIO a propósito: un default acá metería el nombre de
   *  una feature adentro del transporte compartido, y el tercer caller serviría
   *  archivos con el nombre de la primera sin enterarse. */
  presignDownload(key: string, contentType: string, filename: string): Promise<string>
  head(key: string): Promise<{ contentLength: number; contentType: string | null } | null>
  remove(key: string): Promise<void>
}

/** Inyección de storage para tests: `undefined` = usar el real, `null` = simular
 *  que R2 no está configurado. Vive acá y no en cada server action porque los
 *  módulos `'use server'` sólo pueden exportar funciones async. */
export type StorageDeps = { storage?: ObjectStorage | null }

export function resolveStorage(injected?: ObjectStorage | null): ObjectStorage | null {
  return injected !== undefined ? injected : getObjectStorage()
}

interface R2Config {
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

function readConfig(): R2Config | null {
  const endpoint = resolveR2Endpoint({
    accountId: process.env.R2_ACCOUNT_ID,
    endpoint: process.env.R2_ENDPOINT,
  })
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) return null
  return { endpoint, accessKeyId, secretAccessKey, bucket }
}

/** never-throws: para gatear la feature en UI y actions. */
export function isObjectStorageAvailable(): boolean {
  return readConfig() !== null
}

// El S3Client se memoiza por config: armarlo resuelve credenciales y arma un
// pool de conexiones, y con las fotos esto pasó de "una vez por comprobante
// visto" a "una vez por <img> de la grilla". La clave incluye la config para que
// un test que cambia las envs no se quede con el cliente viejo.
let cachedClient: { key: string; client: S3Client } | null = null

function getClient(cfg: R2Config): S3Client {
  const key = JSON.stringify(cfg)
  if (cachedClient?.key !== key) {
    cachedClient = {
      key,
      client: new S3Client({
        region: 'auto',
        endpoint: cfg.endpoint,
        credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      }),
    }
  }
  return cachedClient.client
}

/** Sanea lo que va adentro de `filename="..."` del Content-Disposition: comillas
 *  y saltos de línea romperían el header. Hoy los callers pasan literales, pero
 *  la firma no puede garantizarlo y el header lo arma este módulo. */
function safeFilename(filename: string): string {
  return filename.replace(/[\r\n"\\]/g, '').trim() || 'archivo'
}

/** null si R2 no está configurado (mirror de getResend()). */
export function getObjectStorage(): ObjectStorage | null {
  const cfg = readConfig()
  if (!cfg) return null
  const client = getClient(cfg)
  return {
    async presignUpload(key, contentType) {
      return getSignedUrl(client, new PutObjectCommand({ Bucket: cfg.bucket, Key: key, ContentType: contentType }), { expiresIn: 120 })
    },
    async presignDownload(key, contentType, filename) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          ResponseContentType: contentType,
          ResponseContentDisposition: `inline; filename="${safeFilename(filename)}"`,
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
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }))
    },
  }
}
