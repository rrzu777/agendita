import { DashboardHeader } from '@/components/dashboard/header'
import { Button } from '@/components/ui/button'
import { Star } from 'lucide-react'

export default function ReviewsPage() {
  return (
    <div>
      <DashboardHeader title="Reseñas" subtitle="Administra reseñas aprobadas y testimonios visibles en tu perfil." />
      <div className="p-5 md:p-10">
        <div className="studio-card flex min-h-[320px] flex-col items-center justify-center p-8 text-center">
          <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-secondary text-primary">
            <Star className="size-8" />
          </div>
          <h2 className="text-2xl font-semibold tracking-normal text-primary">Gestión de reseñas</h2>
          <p className="mt-2 max-w-md text-muted-foreground">
            Esta sección queda lista para moderar, aprobar y destacar comentarios de clientas.
          </p>
          <Button className="mt-6" disabled>Próximamente</Button>
        </div>
      </div>
    </div>
  )
}
