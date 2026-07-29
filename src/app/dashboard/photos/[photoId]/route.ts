import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { requireBusiness } from '@/lib/auth/server'
import { getObjectStorage } from '@/lib/storage/r2'

// Único camino para ver una foto de la ficha: el bucket R2 es PRIVADO. Mismo
// modelo que la ruta del comprobante — verificamos que quien pide sea del
// negocio dueño y recién ahí emitimos un GET prefirmado de 60s que fuerza el
// Content-Type guardado + inline disposition (un HTML disfrazado de foto no se
// ejecuta). Nunca exponemos la key cruda ni una URL pública.
//
// A diferencia del comprobante NO exige owner/admin: la ficha de la clienta ya
// es visible para cualquier persona del equipo, y las fotos son parte de ella.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ photoId: string }> }) {
  const { photoId } = await params
  const { businessId } = await requireBusiness()

  const photo = await prisma.customerPhoto.findUnique({
    where: { id: photoId },
    select: { businessId: true, key: true, contentType: true },
  })
  if (!photo || photo.businessId !== businessId) {
    return new NextResponse('No encontrada', { status: 404 })
  }

  const storage = getObjectStorage()
  if (!storage) return new NextResponse('No disponible', { status: 404 })

  const url = await storage.presignDownload(photo.key, photo.contentType, 'foto')
  return NextResponse.redirect(url, 302)
}
