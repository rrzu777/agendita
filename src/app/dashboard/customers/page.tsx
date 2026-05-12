import { DashboardHeader } from '@/components/dashboard/header'
import { Button } from '@/components/ui/button'
import { Users } from 'lucide-react'

export default function CustomersPage() {
  return (
    <div>
      <DashboardHeader title="Clientas" subtitle="Historial y datos de contacto de quienes reservan contigo." />
      <div className="p-5 md:p-10">
        <div className="studio-card flex min-h-[320px] flex-col items-center justify-center p-8 text-center">
          <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-secondary text-primary">
            <Users className="size-8" />
          </div>
          <h2 className="text-2xl font-semibold tracking-normal text-primary">Gestión de clientas</h2>
          <p className="mt-2 max-w-md text-muted-foreground">
            Esta sección queda preparada para listar clientas, historial de reservas y notas internas.
          </p>
          <Button className="mt-6" disabled>Próximamente</Button>
        </div>
      </div>
    </div>
  )
}
