import Link from 'next/link'
import { prisma } from '@/lib/db'
import { prepareMiUser } from '@/lib/auth/mi-user'
import { getLoyaltyBalance } from '@/lib/loyalty/balance'
import { displayBalance } from '@/lib/loyalty/view'
import { PageMessage } from '@/components/ui/page-message'

export default async function MiHomePage() {
  // await la preparación (fila User + auto-link) ANTES de leer: el layout corre
  // en paralelo y no garantiza el link previo. Cacheada → no duplica trabajo.
  const result = await prepareMiUser()
  if (result.status !== 'ok') return null // layout maneja anon (redirect) / conflict
  const user = result.user

  const customers = await prisma.customer.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      name: true,
      business: {
        select: { id: true, name: true, slug: true, logoUrl: true, loyaltyConfig: { select: { isActive: true, pointsLabel: true } } },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  if (customers.length === 0) {
    return (
      <PageMessage
        title="Todavía no hay nada por aquí"
        message="Abre el enlace de tu tarjeta de beneficios, o haz una reserva con este email, y tus negocios van a aparecer acá."
      />
    )
  }

  // Lecturas simples (agregados), sin tx interactiva → paralelo seguro.
  const balances = await Promise.all(
    customers.map((c) => getLoyaltyBalance(prisma, c.id, c.business.id)),
  )

  return (
    <main className="pb-10">
      <h1 className="text-lg font-semibold">Mis negocios</h1>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {customers.map((c, i) => (
          <li key={c.id}>
            <Link href={`/mi/${c.business.slug}`} className="block rounded-2xl border border-gray-100 bg-pink-50/50 px-4 py-4 hover:bg-pink-50">
              <div className="font-medium">{c.business.name}</div>
              {c.business.loyaltyConfig?.isActive && (
                <div className="mt-1 text-sm text-pink-700">
                  {displayBalance(balances[i])} {c.business.loyaltyConfig.pointsLabel}
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
