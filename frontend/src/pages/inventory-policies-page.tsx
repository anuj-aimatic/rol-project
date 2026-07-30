import { Link } from 'react-router-dom'
import { useMemo } from 'react'

import { ContentCard } from '@/components/common/content-card'
import { PageHeader } from '@/components/common/page-header'
import { countBy, useProcessedData } from '@/services/state/processed-data-context'

const POLICY_MAP: Record<string, string> = {
  High_Risk_External: 'High Priority · Weekly review · 95% service level',
  Medium_Risk_External: 'Medium Priority · Bi-weekly review · 90% service level',
  Medium_Risk_Internal: 'Medium Priority · Monthly review · 85% service level',
  Low_Risk_External: 'Low Priority · Monthly review · 85% service level',
  Low_Risk_Internal: 'Low Priority · Quarterly review · 80% service level',
}

export function InventoryPoliciesPage() {
  const { result } = useProcessedData()

  const policyData = useMemo(() => {
    if (!result) return []
    const riskCounts = countBy(result.data, 'Risk_Category')
    return Object.entries(riskCounts)
      .map(([risk, count]) => ({
        risk,
        count,
        policy: POLICY_MAP[risk] ?? 'Standard Policy · 85% service level',
      }))
      .sort((a, b) => b.count - a.count)
  }, [result])

  if (!result) {
    return (
      <div>
        <PageHeader
          title="Inventory Policies"
          subtitle="Reference matrix for service level, priority, and review frequency."
        />
        <ContentCard title="No Data" description="Run the pipeline first.">
          <p className="text-sm text-muted-foreground">
            Open <Link to="/overview" className="text-primary underline">Overview</Link> to process data.
          </p>
        </ContentCard>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Inventory Policies"
        subtitle="Policy recommendations based on Risk Category segmentation."
      />

      <ContentCard title="Risk-Based Policy Matrix" description="Derived from customer concentration risk analysis.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Risk Category</th>
                <th className="px-3 py-2">Products</th>
                <th className="px-3 py-2">% of Total</th>
                <th className="px-3 py-2">Recommended Policy</th>
              </tr>
            </thead>
            <tbody>
              {policyData.map((p) => (
                <tr key={p.risk} className="border-b border-border/60">
                  <td className="px-3 py-2 font-medium text-foreground">{p.risk}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.count.toLocaleString()}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {((p.count / result.rows) * 100).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{p.policy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ContentCard>

      <ContentCard
        title="ABC-RFM Heuristics"
        description="Quick guidelines based on combined segmentation."
        className="mt-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ['A × Runner', 'Weekly review, 95%+ SL, high safety stock'],
            ['A × Repeater', 'Bi-weekly review, 90% SL, moderate safety stock'],
            ['B × Runner', 'Bi-weekly review, 90% SL, standard safety stock'],
            ['B × Repeater', 'Monthly review, 85% SL, standard safety stock'],
            ['C × Dormant', 'Quarterly review, 80% SL, minimal safety stock'],
            ['C × Slow Mover', 'Quarterly review, 80% SL, low safety stock'],
          ].map(([segment, policy]) => (
            <div key={segment} className="rounded-xl border border-border bg-background/70 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{segment}</p>
              <p className="mt-1 text-sm text-foreground">{policy}</p>
            </div>
          ))}
        </div>
      </ContentCard>
    </div>
  )
}
