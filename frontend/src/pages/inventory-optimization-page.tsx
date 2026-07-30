import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ContentCard } from '@/components/common/content-card'
import { PageHeader } from '@/components/common/page-header'
import { average, toNumeric, useProcessedData } from '@/services/state/processed-data-context'

export function InventoryOptimizationPage() {
  const { result } = useProcessedData()

  const stats = useMemo(() => {
    if (!result) return null
    const d = result.data
    const avgStatic = average(d, 'rol_static')
    const avgDynamic = average(d, 'rol_dynamic')
    const avgSsStatic = average(d, 'st_safety_stock')
    const avgSsDynamic = average(d, 'dy_safety_stock')
    const staticTotal = d.reduce((s, r) => s + toNumeric(r.rol_static), 0)
    const dynamicTotal = d.reduce((s, r) => s + toNumeric(r.rol_dynamic), 0)
    return {
      avgStatic,
      avgDynamic,
      avgSsStatic,
      avgSsDynamic,
      staticTotal,
      dynamicTotal,
      rolDelta: avgStatic === 0 ? 0 : ((avgDynamic - avgStatic) / avgStatic) * 100,
      ssDelta: avgSsStatic === 0 ? 0 : ((avgSsDynamic - avgSsStatic) / avgSsStatic) * 100,
    }
  }, [result])

  const bucketData = useMemo(() => {
    if (!result) return []
    const buckets: Record<string, { label: string; static: number; dynamic: number }> = {}
    for (const row of result.data) {
      const s = toNumeric(row.rol_static)
      const d = toNumeric(row.rol_dynamic)
      const range = (v: number) => {
        if (v <= 50) return '0–50'
        if (v <= 200) return '51–200'
        if (v <= 500) return '201–500'
        if (v <= 1000) return '501–1K'
        return '> 1K'
      }
      const sk = range(s)
      const dk = range(d)
      buckets[sk] = buckets[sk] ?? { label: sk, static: 0, dynamic: 0 }
      buckets[dk] = buckets[dk] ?? { label: dk, dynamic: 0, static: 0 }
      buckets[sk].static++
      buckets[dk].dynamic++
    }
    const order = ['0–50', '51–200', '201–500', '501–1K', '> 1K']
    return order.map((l) => buckets[l]).filter(Boolean)
  }, [result])

  if (!result) {
    return (
      <div>
        <PageHeader
          title="Inventory Optimization"
          subtitle="Compare Static vs Dynamic ROL and Safety Stock across all products."
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
        title="Inventory Optimization"
        subtitle="Static (volume-binned) vs Dynamic (mode-binned) ROL comparison."
      />

      {/* Side-by-side KPI cards */}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <ContentCard title="Static ROL (Volume-binned)" description="Bin sizes: 0 / 12 / 24 based on total sales volume.">
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-muted-foreground">Avg ROL</span>
              <span className="font-medium text-foreground">{stats?.avgStatic.toFixed(1)}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-muted-foreground">Total ROL</span>
              <span className="font-medium text-foreground">{stats?.staticTotal.toFixed(0)}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-muted-foreground">Avg Safety Stock</span>
              <span className="font-medium text-foreground">{stats?.avgSsStatic.toFixed(1)}</span>
            </div>
          </div>
        </ContentCard>

        <ContentCard title="Dynamic ROL (Mode-binned)" description="Bin size = mode of weekly demand per SKU.">
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-muted-foreground">Avg ROL</span>
              <span className="font-medium text-foreground">{stats?.avgDynamic.toFixed(1)}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-muted-foreground">Total ROL</span>
              <span className="font-medium text-foreground">{stats?.dynamicTotal.toFixed(0)}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-muted-foreground">Avg Safety Stock</span>
              <span className="font-medium text-foreground">{stats?.avgSsDynamic.toFixed(1)}</span>
            </div>
          </div>
        </ContentCard>
      </div>

      {/* Deltas */}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <ContentCard title="ROL Delta" description="% change from Static to Dynamic.">
          <div className="flex items-center gap-3">
            <span
              className={`text-2xl font-semibold ${(stats?.rolDelta ?? 0) >= 0 ? 'text-amber-500' : 'text-emerald-500'}`}
            >
              {(stats?.rolDelta ?? 0) >= 0 ? '+' : ''}
              {stats?.rolDelta.toFixed(1)}%
            </span>
            <span className="text-sm text-muted-foreground">
              Dynamic ROL is {(stats?.rolDelta ?? 0) >= 0 ? 'higher' : 'lower'} on average
            </span>
          </div>
        </ContentCard>

        <ContentCard title="Safety Stock Delta" description="% change from Static to Dynamic.">
          <div className="flex items-center gap-3">
            <span
              className={`text-2xl font-semibold ${(stats?.ssDelta ?? 0) >= 0 ? 'text-amber-500' : 'text-emerald-500'}`}
            >
              {(stats?.ssDelta ?? 0) >= 0 ? '+' : ''}
              {stats?.ssDelta.toFixed(1)}%
            </span>
            <span className="text-sm text-muted-foreground">
              Dynamic Safety Stock is {(stats?.ssDelta ?? 0) >= 0 ? 'higher' : 'lower'} on average
            </span>
          </div>
        </ContentCard>
      </div>

      {/* ROL Distribution Chart */}
      <ContentCard title="ROL Distribution" description="Number of products per ROL range — Static vs Dynamic.">
        <div className="h-72 rounded-xl border border-border bg-background/60 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bucketData} margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="static" name="Static ROL" fill="#2563eb" radius={[4, 4, 0, 0]} />
              <Bar dataKey="dynamic" name="Dynamic ROL" fill="#16a34a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ContentCard>
    </div>
  )
}
