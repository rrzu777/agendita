import { redirect } from 'next/navigation'
import { DashboardSidebar } from '@/components/dashboard/sidebar'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'

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
    redirect('/recover-business')
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
