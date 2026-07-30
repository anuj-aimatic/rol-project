import { FilterX } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
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

const FILTER_COLS = ['ABC_Class', 'RFM_Category', 'Risk_Category'] as const
type FilterKey = (typeof FILTER_COLS)[number]

const FILTER_LABELS: Record<FilterKey, string> = {
  ABC_Class: 'ABC',
  RFM_Category: 'RFM',
  Risk_Category: 'Risk',
}

/* ---------- component ---------- */

export function InventoryOptimizationPage() {
  const { result } = useProcessedData()

  // Filter state: column -> selected value (empty string = all)
  const [filters, setFilters] = useState<Record<FilterKey, string>>({
    ABC_Class: '',
    RFM_Category: '',
    Risk_Category: '',
  })

  // ---------- unique filter options ----------
  const filterOptions = useMemo(() => {
    if (!result) return {} as Record<FilterKey, string[]>
    const opts = {} as Record<FilterKey, string[]>
    for (const col of FILTER_COLS) {
      const set = new Set<string>()
      for (const row of result.data) {
        const v = String(row[col] ?? '')
        if (v) set.add(v)
      }
      opts[col] = [...set].sort()
    }
    return opts
  }, [result])

  // ---------- filtered data ----------
  const filteredData = useMemo(() => {
    if (!result) return []
    const active = Object.entries(filters).filter(([, v]) => v) as [FilterKey, string][]
    if (active.length === 0) return result.data
    return result.data.filter((r) =>
      active.every(([col, val]) => String(r[col] ?? '') === val),
    )
  }, [result, filters])

  // ---------- KPI stats ----------
  const stats = useMemo(() => {
    if (filteredData.length === 0) return null
    const d = filteredData
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
  }, [filteredData])

  // ---------- ROL distribution buckets ----------
  const bucketData = useMemo(() => {
    if (filteredData.length === 0) return []
    const buckets: Record<string, { label: string; static: number; dynamic: number }> = {}
    for (const row of filteredData) {
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
  }, [filteredData])

  // ---------- filter update ----------
  const setFilter = (col: FilterKey, value: string) => {
    setFilters((prev) => ({ ...prev, [col]: value }))
  }

  const clearFilters = () => {
    setFilters({ ABC_Class: '', RFM_Category: '', Risk_Category: '' })
  }

  const activeFilterCount = Object.values(filters).filter(Boolean).length

  // ---------- render ----------
  if (!result) {
    return (
      <div>
        <PageHeader
          title="Inventory Optimization"
          subtitle="Compare Static vs Dynamic ROL and Safety Stock across all products."
        />
        <ContentCard title="No Data" description="Run the pipeline first.">
          <p className="text-sm text-muted-foreground">
            Open{' '}
            <Link to="/overview" className="text-primary underline">
              Overview
            </Link>{' '}
            to process data.
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

      {/* ---------- Filter bar ---------- */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background/60 px-4 py-3">
        <span className="text-xs font-medium text-muted-foreground">Filters:</span>
        {FILTER_COLS.map((col) => {
          const opts = filterOptions[col] ?? []
          return (
            <select
              key={col}
              value={filters[col]}
              onChange={(e) => setFilter(col, e.target.value)}
              className="h-8 cursor-pointer rounded-lg border border-border bg-card px-2 pr-6 text-xs outline-none focus:border-ring"
            >
              <option value="">{FILTER_LABELS[col]}: All</option>
              {opts.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          )
        })}

        {activeFilterCount > 0 && (
          <>
            <span className="text-xs text-muted-foreground">
              {filteredData.length.toLocaleString()} products
            </span>
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted/60"
            >
              <FilterX size={12} />
              Clear
            </button>
          </>
        )}
      </div>

      {/* ---------- KPI cards ---------- */}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <ContentCard
          title="Static ROL (Volume-binned)"
          description="Bin sizes: 0 / 12 / 24 based on total sales volume."
        >
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-muted-foreground">Avg ROL</span>
              <span className="font-medium text-foreground">
                {stats?.avgStatic.toFixed(1) ?? '—'}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-muted-foreground">Total ROL</span>
              <span className="font-medium text-foreground">
                {stats?.staticTotal.toFixed(0) ?? '—'}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-muted-foreground">Avg Safety Stock</span>
              <span className="font-medium text-foreground">
                {stats?.avgSsStatic.toFixed(1) ?? '—'}
              </span>
            </div>
          </div>
        </ContentCard>

        <ContentCard
          title="Dynamic ROL (Mode-binned)"
          description="Bin size = mode of weekly demand per SKU."
        >
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-muted-foreground">Avg ROL</span>
              <span className="font-medium text-foreground">
                {stats?.avgDynamic.toFixed(1) ?? '—'}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-muted-foreground">Total ROL</span>
              <span className="font-medium text-foreground">
                {stats?.dynamicTotal.toFixed(0) ?? '—'}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-muted-foreground">Avg Safety Stock</span>
              <span className="font-medium text-foreground">
                {stats?.avgSsDynamic.toFixed(1) ?? '—'}
              </span>
            </div>
          </div>
        </ContentCard>
      </div>

      {/* ---------- Delta cards ---------- */}
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
              Dynamic Safety Stock is {(stats?.ssDelta ?? 0) >= 0 ? 'higher' : 'lower'} on
              average
            </span>
          </div>
        </ContentCard>
      </div>

      {/* ---------- ROL Distribution Chart ---------- */}
      <ContentCard
        title="ROL Distribution"
        description={
          activeFilterCount > 0
            ? `Number of products per ROL range — filtered by ${activeFilterCount} dimension(s).`
            : 'Number of products per ROL range — Static vs Dynamic.'
        }
      >
        {filteredData.length === 0 ? (
          <div className="flex h-72 items-center justify-center rounded-xl border border-border bg-background/60">
            <p className="text-sm text-muted-foreground">
              No products match the current filters.
            </p>
          </div>
        ) : (
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
        )}
      </ContentCard>
    </div>
  )
}
