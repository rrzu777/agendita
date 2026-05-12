import { DashboardHeader } from '@/components/dashboard/header'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'

export default function SettingsPage() {
  return (
    <div>
      <DashboardHeader title="Configuración" subtitle="Datos del estudio, perfil público e integraciones." />
      <div className="p-5 md:p-10">
        <div className="studio-card flex min-h-[320px] flex-col items-center justify-center p-8 text-center">
          <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-secondary text-primary">
            <Settings className="size-8" />
          </div>
          <h2 className="text-2xl font-semibold tracking-normal text-primary">Configuración del estudio</h2>
          <p className="mt-2 max-w-md text-muted-foreground">
            Esta sección queda preparada para editar marca, enlaces, pagos y preferencias operativas.
          </p>
          <Button className="mt-6" disabled>Próximamente</Button>
        </div>
      </div>
    </div>
  )
}
