import { redirect } from 'next/navigation'
import { DashboardSidebar } from '@/components/dashboard/sidebar'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { prisma } from '@/lib/db'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const userData = await getCurrentUserWithBusiness()

  if (!userData || !userData.user) {
    redirect('/login')
  }

  if (!userData.business) {
    // Una clienta logueada que cae en /dashboard no debe terminar en el flujo
    // de recuperación de negocio: si tiene Customer vinculados, su casa es /mi.
    const linkedCustomers = await prisma.customer.count({ where: { userId: userData.user.id } })
    redirect(linkedCustomers > 0 ? '/mi' : '/recover-business')
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <DashboardSidebar user={userData.user} business={userData.business} />
      <main className="min-w-0 flex-1 pb-24 md:pb-0">
        {children}
      </main>
    </div>
  )
}
