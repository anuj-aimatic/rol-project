import { Link, useParams } from 'react-router-dom'

import { ContentCard } from '@/components/common/content-card'
import { PageHeader } from '@/components/common/page-header'
import { useProcessedData } from '@/services/state/processed-data-context'

function fmt(v: unknown, decimals = 2): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number' && Number.isFinite(v)) return v.toFixed(decimals)
  return String(v)
}

export function ProductDetailPage() {
  const { itemCode } = useParams()
  const { result } = useProcessedData()

  if (!result) {
    return (
      <div>
        <PageHeader title={`Product Detail: ${itemCode ?? 'Unknown'}`} subtitle="Full decision-support metrics." />
        <ContentCard title="No Data" description="Run the pipeline first.">
          <p className="text-sm text-muted-foreground">
            Go to <Link to="/overview" className="text-primary underline">Overview</Link> to process data, then
            click a product in <Link to="/inventory-explorer" className="text-primary underline">Inventory Explorer</Link>.
          </p>
        </ContentCard>
      </div>
    )
  }

  const row = result.data.find((r) => String(r.Item_Code ?? '') === itemCode)
  if (!row) {
    return (
      <div>
        <PageHeader title={`Product Detail: ${itemCode ?? 'Unknown'}`} subtitle="Item not found in dataset." />
        <ContentCard title="Not Found" description="This Item_Code does not match any processed product.">
          <Link to="/inventory-explorer" className="text-sm text-primary underline">← Back to Explorer</Link>
        </ContentCard>
      </div>
    )
  }

  const metrics: [string, string, string][] = [
    ['Classification', 'ABC Class', row.ABC_Class as string],
    ['Classification', 'RFM Category', row.RFM_Category as string],
    ['Classification', 'RFM Score', String(row.RFM_Score ?? '—')],
    ['Classification', 'Risk Category', row.Risk_Category as string],
    ['Classification', 'Product Group', fmt(row['Product Group Code'])],
    ['Classification', 'Subgroup', fmt(row.Product_SubGroup_Code)],
    ['Demand', 'Total Weeks', fmt(row.total_weeks, 0)],
    ['Demand', 'Weeks w/ Orders', fmt(row.weeks_with_orders, 0)],
    ['Demand', 'Weeks w/ Zero Orders', fmt(row.weeks_with_zero_orders, 0)],
    ['Demand', 'Mode Order Qty', fmt(row.mode_order_qty, 0)],
    ['Demand', 'Recency (days)', fmt(row.Recency, 0)],
    ['Demand', 'Frequency', fmt(row.Frequency, 0)],
    ['Demand', 'Monetary', fmt(row.Monetary, 2)],
    ['Static ROL', 'ROL (Static)', fmt(row.rol_static, 1)],
    ['Static ROL', 'Safety Stock (Static)', fmt(row.st_safety_stock, 1)],
    ['Static ROL', 'Avg Weekly (Static)', fmt(row.st_avg_weekly_demand, 1)],
    ['Static ROL', 'Dmax Week (Static)', fmt(row.st_dmax_week, 0)],
    ['Static ROL', 'Mode Weekly (Static)', fmt(row.st_mode_weekly_demand, 0)],
    ['Dynamic ROL', 'ROL (Dynamic)', fmt(row.rol_dynamic, 1)],
    ['Dynamic ROL', 'Safety Stock (Dynamic)', fmt(row.dy_safety_stock, 1)],
    ['Dynamic ROL', 'Avg Weekly (Dynamic)', fmt(row.dy_avg_weekly_demand, 1)],
    ['Dynamic ROL', 'Dmax Week (Dynamic)', fmt(row.dy_dmax_week, 0)],
    ['Dynamic ROL', 'Mode Weekly (Dynamic)', fmt(row.dy_mode_weekly_demand, 0)],
  ]

  const groups = [...new Set(metrics.map(([g]) => g))]

  return (
    <div>
      <PageHeader
        title={`Product Detail: ${itemCode}`}
        subtitle="Full decision-support metrics from ABC-RFM-Risk-ROL pipeline."
      />

      <div className="mb-4">
        <Link to="/inventory-explorer" className="text-sm text-primary hover:underline">← Back to Explorer</Link>
      </div>

      {groups.map((group) => (
        <div key={group} className="mb-4">
          <ContentCard title={group} description={`${group} metrics for this product.`}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {metrics
                .filter(([g]) => g === group)
                .map(([, label, value]) => {
                  const isRol = label.startsWith('ROL')
                  const valNum = Number(value)
                  const isHigher = isRol && !isNaN(valNum) && valNum > 0
                  return (
                    <div key={label} className="rounded-xl border border-border bg-background/70 p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                      <p
                        className={`mt-1 text-sm font-medium ${
                          isHigher ? 'text-primary' : 'text-foreground'
                        }`}
                      >
                        {value}
                      </p>
                    </div>
                  )
                })}
            </div>
          </ContentCard>
        </div>
      ))}

      {/* Recommendation */}
      <ContentCard title="Recommendation" description="Actionable policy narrative based on segmentation.">
        <ul className="space-y-2 text-sm text-foreground">
          <li>
            - Inventory Priority:{' '}
            <strong>{row.ABC_Class === 'A' ? 'High' : row.ABC_Class === 'B' ? 'Medium' : 'Low'}</strong>
          </li>
          <li>
            - Demand Behavior:{' '}
            <strong>{String(row.RFM_Category ?? 'Unknown')}</strong>
          </li>
          <li>
            - Risk Exposure:{' '}
            <strong>{String(row.Risk_Category ?? 'Unknown')}</strong>
          </li>
          <li>
            - Suggested Review:{' '}
            <strong>
              {row.RFM_Category === 'Runner'
                ? 'Weekly'
                : row.RFM_Category === 'Repeater'
                  ? 'Bi-weekly'
                  : 'Monthly'}
            </strong>
          </li>
          <li>
            - ROL Comparison:{' '}
            <strong>
              Static {fmt(row.rol_static, 0)} vs Dynamic {fmt(row.rol_dynamic, 0)}
            </strong>
          </li>
        </ul>
      </ContentCard>
    </div>
  )
}
