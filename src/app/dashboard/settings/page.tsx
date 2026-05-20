import { DashboardHeader } from '@/components/dashboard/header'
import { SettingsForm } from '@/components/dashboard/settings-form'
import { requireBusinessRole, AuthError, ForbiddenError } from '@/lib/auth/server'

export default async function SettingsPage() {
  try {
    const { business } = await requireBusinessRole(['owner', 'admin'])

    return (
      <div>
        <DashboardHeader title="Configuración" subtitle="Datos del estudio, perfil público e integraciones." />
        <div className="p-5 md:p-10">
          <SettingsForm business={business} />
        </div>
      </div>
    )
  } catch (error) {
    const isAuthError = error instanceof AuthError || error instanceof ForbiddenError

    return (
      <div>
        <DashboardHeader title="Configuración" subtitle="Datos del estudio, perfil público e integraciones." />
        <div className="p-5 md:p-10">
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-6 text-destructive">
            {isAuthError
              ? 'No tienes permisos para ver esta página.'
              : 'Ocurrió un error inesperado. Intenta recargar la página.'}
          </div>
        </div>
      </div>
    )
  }
}
