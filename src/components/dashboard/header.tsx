export function DashboardHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="border-b border-border/50 bg-card/80 px-5 py-5 backdrop-blur md:px-10">
      <h1 className="font-heading text-3xl font-semibold tracking-tight text-primary md:text-4xl">{title}</h1>
      {subtitle && <p className="mt-1 text-base text-muted-foreground">{subtitle}</p>}
    </header>
  )
}
