'use client'

import Link from 'next/link'
import { Megaphone } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TruncatedCell } from '@/components/ui/truncated-cell'
import { TableMobileCard } from '@/components/ui/table-mobile-card'
import { TABLE_COL, TABLE_MIN_WIDTH } from '@/components/ui/table-widths'
import { segmentLabel } from '@/lib/campaigns/labels'

export interface CampaignListItem {
  id: string
  name: string
  segmentType: string
  createdAt: Date
  promotion: { name: string }
  _count: { recipients: number }
}

function formatDate(value: Date) {
  return new Date(value).toLocaleDateString('es-CL', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function CampaignList({ campaigns }: { campaigns: CampaignListItem[] }) {
  if (campaigns.length === 0) {
    return (
      <div className="studio-card overflow-hidden py-12 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="flex size-14 items-center justify-center rounded-full bg-muted">
            <Megaphone className="size-7 text-muted-foreground" />
          </div>
          <div>
            <p className="mb-1 font-heading text-base font-semibold text-primary">
              Todavía no creaste ninguna campaña
            </p>
            <p className="text-sm text-muted-foreground">
              Creá tu primera campaña para enviar promos por WhatsApp a un grupo de clientas.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="hidden lg:block studio-card overflow-hidden">
        <Table fixed className={TABLE_MIN_WIDTH}>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Nombre</TableHead>
              <TableHead className="w-[180px]">Segmento</TableHead>
              <TableHead>Promo</TableHead>
              <TableHead className={TABLE_COL.uses}>Destinatarias</TableHead>
              <TableHead className={TABLE_COL.date}>Fecha</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map((c) => (
              <TableRow key={c.id}>
                <TruncatedCell
                  className="font-semibold text-primary"
                  title={c.name}
                  primary={
                    <Link href={`/dashboard/campanas/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                  }
                />
                <TableCell className="w-[180px]">{segmentLabel(c.segmentType)}</TableCell>
                <TruncatedCell primary={c.promotion.name} />
                <TableCell className={TABLE_COL.uses}>{c._count.recipients}</TableCell>
                <TableCell className={`${TABLE_COL.date} whitespace-nowrap text-sm`}>
                  {formatDate(c.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 lg:hidden">
        {campaigns.map((c) => (
          <TableMobileCard
            key={c.id}
            title={
              <Link href={`/dashboard/campanas/${c.id}`} className="hover:underline">
                {c.name}
              </Link>
            }
            subtitle={segmentLabel(c.segmentType)}
            rows={[
              { label: 'Promo', value: c.promotion.name },
              { label: 'Destinatarias', value: c._count.recipients },
              { label: 'Fecha', value: formatDate(c.createdAt) },
            ]}
          />
        ))}
      </div>
    </>
  )
}
