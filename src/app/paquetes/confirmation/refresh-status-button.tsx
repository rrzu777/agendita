'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

export function RefreshStatusButton() {
  const router = useRouter()
  return <Button type="button" size="touch" className="w-full rounded-full" onClick={() => router.refresh()}>Actualizar estado</Button>
}
