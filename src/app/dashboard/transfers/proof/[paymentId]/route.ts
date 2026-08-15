import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { AuthError, ForbiddenError, requireBusinessRole } from '@/lib/auth/server'
import { getObjectStorage } from '@/lib/storage/r2'

// Único camino para ver un comprobante: el bucket R2 es PRIVADO. Verificamos
// que quien pide sea owner/admin del negocio DUEÑO del Payment y recién ahí
// emitimos un GET presignado de 60s que fuerza Content-Type seguro + inline
// disposition (un HTML disfrazado subido como comprobante no se ejecuta). Nunca
// exponemos la key cruda ni una URL pública.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId } = await params
  let businessId: string
  try {
    ;({ businessId } = await requireBusinessRole(['owner', 'admin']))
  } catch (error) {
    if (error instanceof AuthError) {
      return new NextResponse('No autorizado', { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return new NextResponse('Prohibido', { status: 403 })
    }
    throw error
  }

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { businessId: true, proofKey: true, proofContentType: true },
  })
  if (!payment || payment.businessId !== businessId || !payment.proofKey) {
    return new NextResponse('No encontrado', { status: 404 })
  }

  const storage = getObjectStorage()
  if (!storage) return new NextResponse('No disponible', { status: 404 })

  const url = await storage.presignDownload(
    payment.proofKey,
    payment.proofContentType ?? 'application/octet-stream',
    'comprobante',
  )
  return NextResponse.redirect(url, 302)
}
