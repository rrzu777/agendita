import 'server-only'

import { cache } from 'react'
import { redirect } from 'next/navigation'
import { AuthError, ForbiddenError, requireBusinessRole } from '@/lib/auth/server'

export const requireSettingsPageAccess = cache(async () => {
  try {
    return await requireBusinessRole(['owner', 'admin'])
  } catch (error) {
    if (error instanceof AuthError) redirect('/login')
    if (error instanceof ForbiddenError) redirect('/dashboard')
    throw error
  }
})
