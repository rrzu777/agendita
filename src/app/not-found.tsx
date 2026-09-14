import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { MarketingShell } from '@/components/platform/platform-shell'

export default function NotFound() {
  return (
    <MarketingShell><main className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-4 py-20">
      <div className="mb-4 text-8xl font-bold text-primary/10">404</div>
      <h1 className="mb-2 text-2xl font-semibold text-primary">Página no encontrada</h1>
      <p className="mb-6 text-center text-muted-foreground">
        La página que buscas no existe o fue movida.
      </p>
      <Button asChild size="touch" className="rounded-lg font-semibold"><Link href="/">Volver al inicio</Link></Button>
    </main></MarketingShell>
  )
}
