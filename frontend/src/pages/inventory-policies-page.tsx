import { Link } from 'react-router-dom'

import { ContentCard } from '@/components/common/content-card'
import { PageHeader } from '@/components/common/page-header'
import { useProcessedData } from '@/services/state/processed-data-context'

export function InventoryPoliciesPage() {
  const { dataset } = useProcessedData()

  if (!dataset) {
    return (
      <div>
        <PageHeader
          title="Inventory Policies"
          subtitle="Reference matrix for service level, priority, review frequency, and replenishment strategy."
        />
        <ContentCard title="No Policy Dataset" description="Run the pipeline first from Overview.">
          <p className="text-sm text-muted-foreground">
            Policy insights depend on segmentation output. Open <Link to="/overview" className="text-primary underline">Overview</Link> and run analysis.
          </p>
        </ContentCard>
      </div>
    )
  }

  const policyCounts = new Map<string, number>()
  for (const row of dataset.data) {
    const key = String(row.Recommended_Inventory_Policy ?? 'Unspecified')
    policyCounts.set(key, (policyCounts.get(key) ?? 0) + 1)
  }

  return (
    <div>
      <PageHeader
        title="Inventory Policies"
        subtitle="Reference matrix for service level, priority, review frequency, and replenishment strategy."
      />

      <ContentCard title="Policy Matrix" description="Recommended policy distribution from processed data.">
        <div className="space-y-2">
          {[...policyCounts.entries()].sort((a, b) => b[1] - a[1]).map(([policy, count]) => (
            <div key={policy} className="flex items-center justify-between rounded-lg border border-border bg-background/70 px-3 py-2 text-sm">
              <span className="text-foreground">{policy}</span>
              <span className="font-medium text-primary">{count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </ContentCard>
    </div>
  )
}
