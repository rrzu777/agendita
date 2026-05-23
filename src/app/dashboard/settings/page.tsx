import { DashboardHeader } from '@/components/dashboard/header'
import { SettingsForm } from '@/components/dashboard/settings-form'
import { requireBusinessRole, AuthError, ForbiddenError } from '@/lib/auth/server'
import type { Business } from '@prisma/client'

export default async function SettingsPage() {
  let business: Business | null = null
  let errorMessage: string | null = null

  try {
    const result = await requireBusinessRole(['owner', 'admin'])
    business = result.business as Business
  } catch (error) {
    const isAuthError = error instanceof AuthError || error instanceof ForbiddenError
    errorMessage = isAuthError
      ? 'No tienes permisos para ver esta página.'
      : 'Ocurrió un error inesperado. Intenta recargar la página.'
  }

  const header = <DashboardHeader title="Configuración" subtitle="Datos del estudio, perfil público e integraciones." />

  if (errorMessage) {
    return (
      <div>
        {header}
        <div className="p-5 md:p-10">
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-6 text-destructive">
            {errorMessage}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {header}
      <div className="p-5 md:p-10">
        <SettingsForm business={business!} />
      </div>
    </div>
  )
}
