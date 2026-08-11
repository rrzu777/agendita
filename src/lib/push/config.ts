import {
  isMatchingVapidKeyPair,
  isValidVapidPrivateKey,
  isValidVapidPublicKey,
} from './vapid-validation'

function isValidVapidSubject(value: string): boolean {
  if (/^mailto:[^@\s]+@[^@\s]+$/i.test(value)) return true
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.length > 0
  } catch {
    return false
  }
}

/** Runtime-safe counterpart of the build validation gate. */
export function hasUsablePushConfig(): boolean {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''
  const privateKey = process.env.VAPID_PRIVATE_KEY || ''
  const subject = process.env.VAPID_SUBJECT || ''
  if (!publicKey || !privateKey || !subject || !process.env.ENCRYPTION_KEY) return false

  return isValidVapidPublicKey(publicKey)
    && isValidVapidPrivateKey(privateKey)
    && isMatchingVapidKeyPair(publicKey, privateKey)
    && isValidVapidSubject(subject)
}
