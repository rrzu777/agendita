// This CommonJS module is shared by the TypeScript runtime validator and the
// pre-build Node script, so both deployment gates enforce identical key rules.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createECDH, ECDH } = require('crypto')

/**
 * @param {unknown} value
 * @returns {Buffer | null}
 */
function decodeCanonicalBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return null

  const decoded = Buffer.from(value, 'base64url')
  return decoded.toString('base64url') === value ? decoded : null
}

/** @param {unknown} value */
function isValidVapidPublicKey(value) {
  const decoded = decodeCanonicalBase64Url(value)
  if (!decoded || decoded.length !== 65 || decoded[0] !== 0x04) return false

  try {
    ECDH.convertKey(decoded, 'prime256v1')
    return true
  } catch {
    return false
  }
}

/** @param {unknown} value */
function isValidVapidPrivateKey(value) {
  const decoded = decodeCanonicalBase64Url(value)
  if (!decoded || decoded.length !== 32) return false

  try {
    const ecdh = createECDH('prime256v1')
    ecdh.setPrivateKey(decoded)
    return true
  } catch {
    return false
  }
}

module.exports = {
  decodeCanonicalBase64Url,
  isValidVapidPrivateKey,
  isValidVapidPublicKey,
}
