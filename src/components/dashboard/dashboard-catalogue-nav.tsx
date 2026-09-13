import type { BusinessRole } from '@prisma/client'
import type { Vocabulary } from '@/lib/vocabulary'
import { getDashboardNavGroups } from '@/lib/dashboard/navigation'
import { DashboardContextNav } from './dashboard-context-nav'

export function DashboardCatalogueNav({ vocabulary, role }: { vocabulary: Vocabulary; role: BusinessRole }) {
  const group = getDashboardNavGroups(vocabulary, role).find((item) => item.key === 'catalogue')
  if (!group) return null
  return <DashboardContextNav label={group.label} items={group.items.map(({ href, label }) => ({ href, label }))} className="mb-6" />
}
