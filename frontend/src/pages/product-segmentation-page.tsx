import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ContentCard } from '@/components/common/content-card'
import { PageHeader } from '@/components/common/page-header'
import { PlotlySunburst } from '@/components/charts/plotly-sunburst'
import { cn } from '@/lib/utils'
import { countBy, useProcessedData } from '@/services/state/processed-data-context'

const TABS = ['ABC', 'RFM', 'Risk'] as const
type Tab = (typeof TABS)[number]

const COLORS = ['#2563eb', '#0ea5e9', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2']

export function ProductSegmentationPage() {
  const { result } = useProcessedData()
  const [tab, setTab] = useState<Tab>('ABC')

  /* ----- distribution chart data ----- */
  const distData = (() => {
    if (!result) return []
    const field =
      tab === 'ABC' ? 'ABC_Class' : tab === 'RFM' ? 'RFM_Category' : 'Risk_Category'
    const raw = countBy(result.data, field)
    return Object.entries(raw)
      .map(([k, v]) => ({ name: k, count: v }))
      .sort((a, b) => b.count - a.count)
  })()

  const subtitle =
    tab === 'ABC'
      ? 'Demand contribution segmentation.'
      : tab === 'RFM'
        ? 'Recency-Frequency-Monetary behavioral classification.'
        : 'Customer concentration risk categorization.'

  /* ----- cross-tab (ABC × RFM) ----- */
  const crossTab = (() => {
    if (!result) return []
    const map = new Map<string, number>()
    for (const row of result.data) {
      const key = `${String(row.ABC_Class ?? '?')} x ${String(row.RFM_Category ?? '?')}`
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return [...map.entries()]
      .map(([k, v]) => ({ name: k, count: v }))
      .sort((a, b) => b.count - a.count)
  })()

  if (!result) {
    return (
      <div>
        <PageHeader title="Product Segmentation" subtitle="ABC, RFM, and Risk distribution analysis." />
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
        title="Product Segmentation"
        subtitle="Hierarchical product breakdown, classification distributions, and advanced analytics."
      />

      {/* ============ Row 1: Sunburst (full width) ============ */}
      <div className="mb-4">
        <ContentCard
          title="Product Hierarchy Sunburst"
          description="Item_Category_Code → Product Group Code → Product_SubGroup_Code. Sized by order amount, colored by Contribution %."
          className="overflow-hidden"
        >
          <div className="h-[500px]">
            <PlotlySunburst data={result.data} />
          </div>
        </ContentCard>
      </div>

      {/* ============ Row 2: Distribution charts ============ */}
      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        {/* Bar chart with tabs */}
        <ContentCard title={`${tab} Distribution`} description={subtitle}>
          <div className="mb-3 inline-flex rounded-lg border border-border bg-background p-0.5">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  'rounded-md px-3 py-1 text-xs transition-colors',
                  t === tab
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={distData} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" angle={-15} textAnchor="end" height={40} interval={0} fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Bar dataKey="count" name="Products" fill="#2563eb" radius={[4, 4, 0, 0]}>
                  {distData.map((entry, idx) => (
                    <Cell key={entry.name} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ContentCard>

        {/* Donut */}
        <ContentCard title={`${tab} Proportions`} description="Share of total products.">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={distData}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={70}
                  innerRadius={30}
                  label={({ name, percent }: { name?: string; percent?: number }) =>
                    `${name}: ${((percent ?? 0) * 100).toFixed(0)}%`
                  }
                >
                  {distData.map((entry, idx) => (
                    <Cell key={entry.name} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </ContentCard>
      </div>

      {/* ============ Row 3: ABC × RFM Cross-Tab ============ */}
      <div className="mb-4">
        <ContentCard title="ABC × RFM Cross-Tabulation" description="Product count per combined ABC × RFM segment.">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Segmentation</th>
                  <th className="px-3 py-2">Products</th>
                  <th className="px-3 py-2">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {crossTab.map((row) => (
                  <tr key={row.name} className="border-b border-border/60">
                    <td className="px-3 py-2 text-foreground">{row.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.count.toLocaleString()}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {((row.count / result.rows) * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ContentCard>
      </div>
    </div>
  )
}
