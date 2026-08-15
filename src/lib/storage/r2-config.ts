const R2_S3_ENDPOINT =
  /^https:\/\/[a-f0-9]{32}(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com\/?$/i

export function normalizeR2Endpoint(value: string | undefined): string | null {
  if (!value) return null
  if (!R2_S3_ENDPOINT.test(value)) return null

  try {
    const url = new URL(value)
    return url.origin
  } catch {
    return null
  }
}

export function resolveR2Endpoint({
  accountId,
  endpoint,
}: {
  accountId: string | undefined
  endpoint: string | undefined
}): string | null {
  if (accountId) return `https://${accountId}.r2.cloudflarestorage.com`
  return normalizeR2Endpoint(endpoint)
}
