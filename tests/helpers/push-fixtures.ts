export const TEST_VAPID_PUBLIC_KEY = 'BAmuMRGniKzfw0ZShPIqYtZrZM8Ilz2YJYG3eS8T9rXcK3BEMp4ckNkh5EywptWzWaDLfHmcfWXKixB0ghV1HPI'
export const TEST_VAPID_PRIVATE_KEY = 'TXp4YjNafvXJhv6X-AyT-6kG_8BzlCTFc2bebFORnyA'
export const OTHER_VAPID_PUBLIC_KEY = 'BGI7e2exs4xGSXrS5eLhlcJPDS3cCDnjKZSqcxg-KJq4uBT_QcEpNfvgmBzekNbmi-5NtMIrAh9vxNKmpINtlEU'
export const TEST_PUSH_AUTH = 'BwcHBwcHBwcHBwcHBwcHBw'

export function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from(value, 'base64url'))
}
