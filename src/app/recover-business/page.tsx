import { redirect } from 'next/navigation'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { RecoverBusinessForm } from './recover-business-form'

export default async function RecoverBusinessPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (userData.business) {
    redirect('/dashboard')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <RecoverBusinessForm
        email={userData.user.email ?? ''}
        name={(userData.user.user_metadata as { name?: string } | undefined)?.name ?? null}
      />
    </main>
  )
}
