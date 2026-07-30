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
import { cn } from '@/lib/utils'
import { countBy, useProcessedData } from '@/services/state/processed-data-context'

const TABS = ['ABC', 'RFM', 'Risk'] as const
type Tab = (typeof TABS)[number]
const COLORS = ['#2563eb', '#0ea5e9', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2']

export function ProductSegmentationPage() {
  const { result } = useProcessedData()
  const [tab, setTab] = useState<Tab>('ABC')

  const dist = useMemo(() => {
    if (!result) return null
    const field =
      tab === 'ABC' ? 'ABC_Class' : tab === 'RFM' ? 'RFM_Category' : 'Risk_Category'
    const raw = countBy(result.data, field)
    return Object.entries(raw)
      .map(([k, v]) => ({ name: k, count: v }))
      .sort((a, b) => b.count - a.count)
  }, [result, tab])

  const subtitle = useMemo(() => {
    if (tab === 'ABC') return 'Pareto-based demand contribution segmentation.'
    if (tab === 'RFM') return 'Recency-Frequency-Monetary behavioral classification.'
    return 'Customer concentration and business risk categorization.'
  }, [tab])

  /* ----- cross-tabulation (ABC × RFM) for the combined view ----- */
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
    <div>
      <PageHeader
        title="Product Segmentation"
        subtitle="Unified segmentation workspace for ABC, RFM, and Risk logic."
      />

      {/* Tabs */}
      <div className="mb-4 inline-flex rounded-xl border border-border bg-card p-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'rounded-lg px-4 py-2 text-sm transition-colors',
              t === tab ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Distribution charts */}
      <ContentCard title={`${tab} Distribution`} description={subtitle}>
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="h-72 rounded-xl border border-border bg-background/60 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dist ?? []} margin={{ top: 16, right: 12, left: 0, bottom: 36 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" angle={-20} textAnchor="end" height={56} interval={0} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" name="Products" fill="#2563eb" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="h-72 rounded-xl border border-border bg-background/60 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={dist ?? []}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={({ name, percent }: { name?: string; percent?: number }) =>
                    `${name}: ${((percent ?? 0) * 100).toFixed(1)}%`
                  }
                >
                  {(dist ?? []).map((entry, idx) => (
                    <Cell key={entry.name} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </ContentCard>

      {/* ABC × RFM cross-tabulation */}
      {tab === 'ABC' && (
        <ContentCard title="ABC × RFM Cross-Tab" description="Combined segmentation matrix — all products by ABC class and RFM category." className="mt-4">
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
      )}
    </div>
  )
}
