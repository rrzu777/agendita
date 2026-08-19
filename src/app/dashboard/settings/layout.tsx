import { DashboardHeader } from '@/components/dashboard/header'
import { SettingsShell } from '@/components/dashboard/settings/settings-shell'
import { requireSettingsPageAccess } from '@/lib/business/settings-access'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireSettingsPageAccess()

  return (
    <div>
      <DashboardHeader title="Configuración" subtitle="Administra cómo se presenta y funciona tu negocio." />
      <SettingsShell>{children}</SettingsShell>
    </div>
  )
}
