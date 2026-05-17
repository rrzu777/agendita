import { getCurrentUser, getCurrentUserWithBusiness } from './user'
import type { BusinessRole } from '@prisma/client'

export class AuthError extends Error {
  constructor(message: string = 'No autorizado') {
    super(message)
    this.name = 'AuthError'
  }
}

export class ForbiddenError extends Error {
  constructor(message: string = 'No tienes permisos para realizar esta acción') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export async function requireUser() {
  const user = await getCurrentUser()
  if (!user) {
    throw new AuthError()
  }
  return user
}

export async function requireBusiness() {
  const userData = await getCurrentUserWithBusiness()
  if (!userData?.business) {
    throw new AuthError('No se encontró un negocio asociado')
  }
  return {
    user: userData.user,
    business: userData.business,
    role: userData.role as BusinessRole,
    businessId: userData.business.id,
  }
}

export async function requireBusinessRole(allowedRoles: BusinessRole[]) {
  const ctx = await requireBusiness()
  if (!allowedRoles.includes(ctx.role)) {
    throw new ForbiddenError()
  }
  return ctx
}

export function assertResourceBelongsToBusiness(resourceBusinessId: string, businessId: string) {
  if (resourceBusinessId !== businessId) {
    throw new ForbiddenError('Recurso no pertenece a este negocio')
  }
}


