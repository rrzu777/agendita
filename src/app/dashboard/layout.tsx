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

  return (
    <div className="flex min-h-screen bg-gray-50">
      <DashboardSidebar user={userData.user} business={userData.business} />
      <main className="flex-1">
        {children}
      </main>
    </div>
  )
}
