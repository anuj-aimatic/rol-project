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

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, n) => sum + n, 0) / values.length
}

export function InventoryOptimizationPage() {
  const { dataset } = useProcessedData()

  if (!dataset) {
    return (
      <div>
        <PageHeader
          title="Inventory Optimization"
          subtitle="Compare Current Client Method against ABC-RF Optimized Method with impact scoring."
        />
        <ContentCard title="No Optimization Dataset" description="Run the pipeline first from Overview.">
          <p className="text-sm text-muted-foreground">
            Optimization deltas need pipeline output. Open <Link to="/overview" className="text-primary underline">Overview</Link> and run analysis.
          </p>
        </ContentCard>
      </div>
    )
  }

  const avgRolClient = average(dataset.data.map((row) => toNumber(row.ROL_Client)))
  const avgRolOptimized = average(dataset.data.map((row) => toNumber(row.ROL_ABC_RF)))
  const avgSsClient = average(dataset.data.map((row) => toNumber(row.Safety_Stock_Client)))
  const avgSsOptimized = average(dataset.data.map((row) => toNumber(row.Safety_Stock_ABC_RF)))

  const rolDeltaPct = avgRolClient === 0 ? 0 : ((avgRolOptimized - avgRolClient) / avgRolClient) * 100
  const ssDeltaPct = avgSsClient === 0 ? 0 : ((avgSsOptimized - avgSsClient) / avgSsClient) * 100

  return (
    <div>
      <PageHeader
        title="Inventory Optimization"
        subtitle="Compare Current Client Method against ABC-RF Optimized Method with impact scoring."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ContentCard title="Current Client Method" description="Fixed service-level baseline.">
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-muted-foreground">Avg ROL</span>
              <span className="font-medium text-foreground">{avgRolClient.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-muted-foreground">Avg Safety Stock</span>
              <span className="font-medium text-foreground">{avgSsClient.toFixed(2)}</span>
            </div>
          </div>
        </ContentCard>
        <ContentCard title="ABC-RF Optimized Method" description="Dynamic policy-driven optimization.">
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-muted-foreground">Avg ROL</span>
              <span className="font-medium text-foreground">{avgRolOptimized.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-muted-foreground">Avg Safety Stock</span>
              <span className="font-medium text-foreground">{avgSsOptimized.toFixed(2)}</span>
            </div>
            <div className="rounded-lg border border-border bg-background/60 px-3 py-2 text-muted-foreground">
              ROL delta: <span className="font-medium text-foreground">{rolDeltaPct.toFixed(2)}%</span> | Safety stock delta:{' '}
              <span className="font-medium text-foreground">{ssDeltaPct.toFixed(2)}%</span>
            </div>
          </div>
        </ContentCard>
      </div>
    </div>
  )
}
