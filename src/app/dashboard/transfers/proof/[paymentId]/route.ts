import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { requireBusinessRole } from '@/lib/auth/server'
import { getProofStorage } from '@/lib/storage/r2'

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
  const { businessId } = await requireBusinessRole(['owner', 'admin'])

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { businessId: true, proofKey: true, proofContentType: true },
  })
  if (!payment || payment.businessId !== businessId || !payment.proofKey) {
    return new NextResponse('No encontrado', { status: 404 })
  }

  const storage = getProofStorage()
  if (!storage) return new NextResponse('No disponible', { status: 404 })

  const url = await storage.presignDownload(
    payment.proofKey,
    payment.proofContentType ?? 'application/octet-stream',
  )
  return NextResponse.redirect(url, 302)
}
