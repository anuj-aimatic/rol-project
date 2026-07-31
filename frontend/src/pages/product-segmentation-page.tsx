import { useMemo, useState } from 'react'
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
import { ParetoChart, RfmScatterChart, RolScatterChart } from '@/components/charts/analysis-charts'
import { cn } from '@/lib/utils'
import { countBy, useProcessedData } from '@/services/state/processed-data-context'

const TABS = ['ABC', 'RFM', 'Risk'] as const
type Tab = (typeof TABS)[number]

const COLORS = ['#2563eb', '#0ea5e9', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2']

export function ProductSegmentationPage() {
  const { result } = useProcessedData()
  const [tab, setTab] = useState<Tab>('ABC')

  const distData = useMemo(() => {
    if (!result) return []
    const field =
      tab === 'ABC' ? 'ABC_Class' : tab === 'RFM' ? 'RFM_Category' : 'Risk_Category'
    const raw = countBy(result.data, field)
    return Object.entries(raw)
      .map(([k, v]) => ({ name: k, count: v }))
      .sort((a, b) => b.count - a.count)
  }, [result, tab])

  const subtitle =
    tab === 'ABC'
      ? 'Demand contribution segmentation.'
      : tab === 'RFM'
        ? 'Recency-Frequency-Monetary behavioral classification.'
        : 'Customer concentration risk categorization.'

  const crossTab = useMemo(() => {
    if (!result) return []
    const map = new Map<string, number>()
    for (const row of result.data) {
      const key = `${String(row.ABC_Class ?? '?')} x ${String(row.RFM_Category ?? '?')}`
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return [...map.entries()]
      .map(([k, v]) => ({ name: k, count: v }))
      .sort((a, b) => b.count - a.count)
  }, [result])

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
    <div className="space-y-6">
      <PageHeader
        title="Product Segmentation"
        subtitle="Hierarchical sunburst, classification distributions, and advanced deep-dive analytics."
      />

      {/* ============ 1. Sunburst ============ */}
      <ContentCard
        title="Product Hierarchy Sunburst"
        description="Item_Category_Code → Product Group Code → Product_SubGroup_Code. Sized by order amount, colored by Contribution %."
        className="overflow-hidden"
      >
        <div className="h-[520px]">
          <PlotlySunburst data={result.data} />
        </div>
      </ContentCard>

      {/* ============ 2. Distribution Overview ============ */}
      <div className="grid gap-6 xl:grid-cols-2">
        <ContentCard title={`${tab} Distribution`} description={subtitle}>
          <div className="mb-3 inline-flex rounded-lg border border-border bg-background p-0.5">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  'rounded-md px-4 py-1.5 text-sm transition-colors',
                  t === tab
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={distData} margin={{ top: 8, right: 16, left: 0, bottom: 32 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" angle={-15} textAnchor="end" height={48} interval={0} fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Bar dataKey="count" name="Products" fill="#2563eb" radius={[6, 6, 0, 0]}>
                  {distData.map((entry, idx) => (
                    <Cell key={entry.name} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ContentCard>

        <ContentCard title={`${tab} Proportions`} description="Share of total products.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={distData}
                  dataKey="count"
                  nameKey="name"
                  cx="45%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={40}
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

      {/* ============ 3. Cross-Tab Table ============ */}
      <ContentCard title="ABC × RFM Cross-Tabulation" description="Product count per combined ABC × RFM segment.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Segmentation</th>
                <th className="px-4 py-3">Products</th>
                <th className="px-4 py-3">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {crossTab.map((row) => (
                <tr key={row.name} className="border-b border-border/60 transition-colors hover:bg-muted/30">
                  <td className="px-4 py-2.5 text-foreground">{row.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{row.count.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {((row.count / result.rows) * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ContentCard>

      {/* ============ 4. Advanced Analytics (one per full-width row) ============ */}
      <h2 className="pt-2 text-xl font-semibold text-foreground">Advanced Analytics</h2>

      {/* Pareto */}
      <ContentCard
        title="ABC Pareto Curve"
        description="Categories ranked by order amount. The green line shows cumulative contribution; the red dashed line marks the 80% threshold."
      >
        <div className="h-80">
          <ParetoChart data={result.data} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          The Pareto principle (80/20 rule) helps identify which product categories drive the majority of revenue.
          Categories to the left of the red line are your most critical.
        </p>
      </ContentCard>

      {/* RFM Scatter */}
      <ContentCard
        title="Recency vs Frequency (RFM Behavioral Clusters)"
        description="Each dot is a product. The Y-axis shows recency in days (most recent at top); the X-axis shows order frequency. Colors indicate RFM category."
      >
        <div className="h-80">
          <RfmScatterChart data={result.data} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground lg:grid-cols-4">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-[#2563eb]" />
            <span>Runners — frequent, recent</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-[#16a34a]" />
            <span>Repeaters — moderate activity</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-[#f59e0b]" />
            <span>Dormant — low frequency, aged</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-[#dc2626]" />
            <span>Slow Movers — sporadic demand</span>
          </div>
        </div>
      </ContentCard>

      {/* ROL Scatter */}
      <ContentCard
        title="Static vs Dynamic ROL Comparison"
        description="Each dot is a product, colored by ABC Class. The X-axis is the volume-binned (static) ROL; the Y-axis is the mode-binned (dynamic) ROL. Points above the diagonal indicate where dynamic ROL exceeds static ROL, and vice versa."
      >
        <div className="h-80">
          <RolScatterChart data={result.data} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Products clustering along the diagonal show agreement between the two methods. 
          Class A products (blue) typically have the highest ROL values and appear in the upper-right.
        </p>
      </ContentCard>
    </div>
  )
}
