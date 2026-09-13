import type { BusinessRole } from '@prisma/client'
import type { Vocabulary } from '@/lib/vocabulary'
import { getDashboardNavGroups, type DashboardNavGroup } from '@/lib/dashboard/navigation'
import { DashboardContextNav } from './dashboard-context-nav'

type DashboardSection = Extract<DashboardNavGroup['key'], 'growth' | 'finance'>

export function DashboardSectionNav({
  section,
  vocabulary,
  role,
  className = 'mb-6',
}: {
  section: DashboardSection
  vocabulary: Vocabulary
  role: BusinessRole
  className?: string
}) {
  const group = getDashboardNavGroups(vocabulary, role).find((item) => item.key === section)
  if (!group) return null

  return (
    <DashboardContextNav
      label={group.label}
      items={group.items.map(({ href, label }) => ({ href, label }))}
      className={className}
    />
  )
}
