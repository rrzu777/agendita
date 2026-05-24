import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="studio-shell flex flex-col items-center justify-center py-20">
      <div className="mb-4 text-8xl font-bold text-primary/10">404</div>
      <h1 className="mb-2 text-2xl font-semibold text-primary">Página no encontrada</h1>
      <p className="mb-6 text-center text-muted-foreground">
        La página que buscas no existe o fue movida.
      </p>
      <Link href="/">
        <Button className="rounded-lg font-semibold">Volver al inicio</Button>
      </Link>
    </div>
  )
}