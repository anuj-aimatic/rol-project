import { Link } from 'react-router-dom'

import { ContentCard } from '@/components/common/content-card'
import { PageHeader } from '@/components/common/page-header'
import { useProcessedData } from '@/services/state/processed-data-context'

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

export function AnalyticsPage() {
  const { dataset } = useProcessedData()

  if (!dataset) {
    return (
      <div>
        <PageHeader
          title="Analytics"
          subtitle="Portfolio-level trend analysis and business storytelling visualizations."
        />
        <ContentCard title="No Analytics Dataset" description="Run the pipeline first from Overview.">
          <p className="text-sm text-muted-foreground">
            Analytics appear after processing. Open <Link to="/overview" className="text-primary underline">Overview</Link> and run analysis.
          </p>
        </ContentCard>
      </div>
    )
  }

  const topItems = [...dataset.data]
    .sort((a, b) => toNumber(b.ROL_ABC_RF ?? b.ROL_Client) - toNumber(a.ROL_ABC_RF ?? a.ROL_Client))
    .slice(0, 10)

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Portfolio-level trend analysis and business storytelling visualizations."
      />

      <ContentCard title="Analytics Workbench" description={`Top products by optimized ROL | Sheet ${dataset.sheetName}`}>
        <div className="mb-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border px-2 py-1">Processed rows: {dataset.rows.toLocaleString()}</span>
          <span className="rounded-full border border-border px-2 py-1">Mode: {dataset.serviceLevelMode}</span>
        </div>

        <div className="space-y-2">
          {topItems.map((row, index) => {
            const itemCode = String(row.Item_Code ?? row.item_code ?? 'Unknown')
            const rol = toNumber(row.ROL_ABC_RF ?? row.ROL_Client)
            return (
              <div key={itemCode + index} className="flex items-center justify-between rounded-lg border border-border bg-background/70 px-3 py-2 text-sm">
                <span className="text-foreground">{itemCode}</span>
                <span className="font-medium text-primary">{rol.toFixed(2)}</span>
              </div>
            )
          })}
        </div>
      </ContentCard>
    </div>
  )
}
