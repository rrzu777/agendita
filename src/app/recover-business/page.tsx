import { redirect } from 'next/navigation'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { RecoverBusinessForm } from './recover-business-form'
import { AuthShell } from '@/components/platform/platform-shell'

export default async function RecoverBusinessPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (userData.business) {
    redirect('/dashboard')
  }

  return (
    <AuthShell audience="owner"><main className="mx-auto w-full max-w-md">
      <RecoverBusinessForm
        email={userData.user.email ?? ''}
        name={(userData.user.user_metadata as { name?: string } | undefined)?.name ?? null}
      />
    </main></AuthShell>
  )
}
