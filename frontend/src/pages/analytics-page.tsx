import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'

import { ContentCard } from '@/components/common/content-card'
import { PageHeader } from '@/components/common/page-header'
import { toNumeric, useProcessedData } from '@/services/state/processed-data-context'

const COLORS = ['#2563eb', '#0ea5e9', '#16a34a', '#f59e0b', '#dc2626']

export function AnalyticsPage() {
  const { result } = useProcessedData()

  /* Top 15 by static ROL */
  const topStatic = useMemo(() => {
    if (!result) return []
    return [...result.data]
      .sort((a, b) => toNumeric(b.rol_static) - toNumeric(a.rol_static))
      .slice(0, 15)
  }, [result])

  /* Top 15 by dynamic ROL */
  const topDynamic = useMemo(() => {
    if (!result) return []
    return [...result.data]
      .sort((a, b) => toNumeric(b.rol_dynamic) - toNumeric(a.rol_dynamic))
      .slice(0, 15)
  }, [result])

  /* Risk category breakdown */
  const riskPie = useMemo(() => {
    if (!result) return []
    const map = new Map<string, number>()
    for (const row of result.data) {
      const r = String(row.Risk_Category ?? 'Unknown')
      map.set(r, (map.get(r) ?? 0) + 1)
    }
    return [...map.entries()]
      .map(([k, v]) => ({ name: k, value: v }))
      .sort((a, b) => b.value - a.value)
  }, [result])

  /* ABC × RFM heatmap-like table */
  const crossTab = useMemo(() => {
    if (!result) return { rows: [] as { rfm: string; cols: { abc: string; count: number }[] }[], headers: [] as string[] }
    const map = new Map<string, number>()
    const abcClasses = new Set<string>()
    const rfmClasses = new Set<string>()
    for (const row of result.data) {
      const a = String(row.ABC_Class ?? '?')
      const r = String(row.RFM_Category ?? '?')
      abcClasses.add(a)
      rfmClasses.add(r)
      const key = `${a}|${r}`
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    const sortedA = [...abcClasses].sort()
    const sortedR = [...rfmClasses].sort()
    return {
      rows: sortedR.map((r) => ({
        rfm: r,
        cols: sortedA.map((a) => ({
          abc: a,
          count: map.get(`${a}|${r}`) ?? 0,
        })),
      })),
      headers: sortedA,
    }
  }, [result])

  if (!result) {
    return (
      <div>
        <PageHeader title="Analytics" subtitle="Portfolio-level trend analysis and business intelligence." />
        <ContentCard title="No Data" description="Run the pipeline first.">
          <p className="text-sm text-muted-foreground">
            Open <Link to="/overview" className="text-primary underline">Overview</Link> to process data.
          </p>
        </ContentCard>
      </div>
    )
  }

  const maxCount = Math.max(
    ...crossTab.rows.flatMap((rr) => rr.cols.map((cc) => cc.count)),
    1,
  )

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Portfolio-level analysis with real pipeline data."
      />

      {/* Row 1: Risk Breakdown + ABC × RFM Matrix side by side */}
      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <ContentCard title="Risk Breakdown" description="Products by Risk_Category.">
          <div className="h-64 rounded-xl border border-border bg-background/60 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={riskPie}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, percent }: { name?: string; percent?: number }) =>
                    `${name}: ${((percent ?? 0) * 100).toFixed(0)}%`
                  }
                >
                  {riskPie.map((_, idx) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </ContentCard>

        <ContentCard title="ABC × RFM Matrix" description="Product count per combined segment.">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1.5">RFM \ ABC</th>
                  {crossTab.headers.map((h) => (
                    <th key={h} className="px-2 py-1.5 text-center">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {crossTab.rows.map((r) => (
                  <tr key={r.rfm} className="border-b border-border/60">
                    <td className="px-2 py-1.5 font-medium text-foreground">{r.rfm}</td>
                    {r.cols.map((c) => {
                      const intensity = c.count / maxCount
                      return (
                        <td
                          key={c.abc}
                          className="px-2 py-1.5 text-center text-muted-foreground"
                          style={{
                            background: `rgba(37, 99, 235, ${intensity * 0.2})`,
                          }}
                        >
                          {c.count}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ContentCard>
      </div>

      {/* Row 2: Top 15 Static ROL + Top 15 Dynamic ROL side by side */}
      <div className="grid gap-4 xl:grid-cols-2">
        <ContentCard title="Top 15 Products by Static ROL" description="Highest static reorder levels.">
          <div className="space-y-1 max-h-[480px] overflow-y-auto pr-1">
            {topStatic.map((row, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg border border-border bg-background/70 px-3 py-1.5 text-sm"
              >
                <span className="text-foreground truncate mr-2">
                  {String(row.Item_Code ?? '—')}
                </span>
                <span className="shrink-0 font-medium text-primary">
                  {toNumeric(row.rol_static).toFixed(0)}
                </span>
              </div>
            ))}
          </div>
        </ContentCard>

        <ContentCard title="Top 15 Products by Dynamic ROL" description="Highest dynamic reorder levels.">
          <div className="space-y-1 max-h-[480px] overflow-y-auto pr-1">
            {topDynamic.map((row, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg border border-border bg-background/70 px-3 py-1.5 text-sm"
              >
                <span className="text-foreground truncate mr-2">
                  {String(row.Item_Code ?? '—')}
                </span>
                <span className="shrink-0 font-medium text-primary">
                  {toNumeric(row.rol_dynamic).toFixed(0)}
                </span>
              </div>
            ))}
          </div>
        </ContentCard>
      </div>
    </div>
  )
}
