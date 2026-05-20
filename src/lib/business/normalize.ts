export function normalizeWhatsapp(input: string | null | undefined): string | null {
  if (!input || input.trim() === '') return null

  let cleaned = input.replace(/[^0-9+]/g, '')

  if (cleaned === '') return null

  if (cleaned.startsWith('+')) {
    return cleaned
  }

  const digits = cleaned.replace(/\D/g, '')

  if (digits.length === 9 && digits.startsWith('9')) {
    return '+56' + digits
  }

  if (digits.length === 8 && /^[2-7]/.test(digits)) {
    return '+56' + digits
  }

  if (digits.length === 11 && digits.startsWith('56')) {
    return '+' + digits
  }

  return cleaned
}

export function normalizeInstagram(input: string | null | undefined): string | null {
  if (!input || input.trim() === '') return null

  let cleaned = input.trim().replace(/\s/g, '')

  const urlMatch = cleaned.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^\/\?#]+)/i)
  if (urlMatch) {
    cleaned = urlMatch[1]
  }

  if (cleaned.startsWith('@')) {
    cleaned = cleaned.slice(1)
  }

  if (cleaned === '') return null

  return cleaned
}
