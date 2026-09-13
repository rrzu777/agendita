import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPlatformAdminUser } from '@/lib/auth/user'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getPlatformAdminUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-[1420px] flex-wrap items-center justify-between gap-3 px-4 py-3 min-[1100px]:px-10">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="flex min-h-11 items-center font-heading text-lg font-semibold text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              Agendita Admin
            </Link>
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
              Interno
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">{user.email}</span>
            <Link href="/dashboard" className="flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              Mi Dashboard
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1420px] px-6 py-8">
        {children}
      </main>
    </div>
  )
}
