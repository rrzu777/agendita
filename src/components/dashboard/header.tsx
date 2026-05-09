export function DashboardHeader({ title }: { title: string }) {
  return (
    <header className="bg-white border-b border-gray-200 px-8 py-5">
      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
    </header>
  )
}
