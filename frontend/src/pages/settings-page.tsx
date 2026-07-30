import { ContentCard } from '@/components/common/content-card'
import { PageHeader } from '@/components/common/page-header'

export function SettingsPage() {
  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Application preferences and environment configuration."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <ContentCard title="Theme" description="Light and dark handcrafted palettes.">
          <p className="text-sm text-muted-foreground">Theme switcher is available in the top navigation.</p>
        </ContentCard>
        <ContentCard title="Default Service Level" description="Baseline fixed method service level.">
          <input
            type="number"
            defaultValue={85}
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none"
          />
        </ContentCard>
        <ContentCard title="API URL" description="Backend endpoint root.">
          <input
            type="text"
            defaultValue="http://127.0.0.1:8000"
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none"
          />
        </ContentCard>
        <ContentCard title="Version" description="Application runtime metadata.">
          <p className="text-sm text-muted-foreground">Inventory IQ v1.0.0</p>
        </ContentCard>
      </div>
    </div>
  )
}
