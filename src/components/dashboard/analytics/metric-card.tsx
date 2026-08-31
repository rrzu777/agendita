import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-mono text-2xl font-semibold tabular-nums text-primary">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{detail}</CardContent>
    </Card>
  )
}
