import { ChevronDown, FilterX, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'

import { ContentCard } from '@/components/common/content-card'
import { PageHeader } from '@/components/common/page-header'
import { useProcessedData } from '@/services/state/processed-data-context'

const PAGE_SIZE = 20

const KEY_COLUMNS = [
  'Item_Code',
  'ABC_Class',
  'RFM_Category',
  'Risk_Category',
  'rol_static',
  'rol_dynamic',
  'st_safety_stock',
  'dy_safety_stock',
  'st_avg_weekly_demand',
  'dy_avg_weekly_demand',
  'st_dmax_week',
  'dy_dmax_week',
  'total_weeks',
  'weeks_with_orders',
  'weeks_with_zero_orders',
  'mode_order_qty',
  'Item_Category_Code',
  'Product Group Code',
  'Product_SubGroup_Code',
  'Recency',
  'Frequency',
  'Monetary',
  'R_Score',
  'F_Score',
  'M_Score',
  'RFM_Score',
  'ABC_Quantum',
  'Contribution (%)',
  'Cumulative Contribution (%)',
]

const COL_LABELS: Record<string, string> = {
  Item_Code: 'Item Code',
  ABC_Class: 'ABC',
  RFM_Category: 'RFM',
  Risk_Category: 'Risk',
  rol_static: 'ROL (S)',
  rol_dynamic: 'ROL (D)',
  st_safety_stock: 'SS (S)',
  dy_safety_stock: 'SS (D)',
  st_avg_weekly_demand: 'Avg Wk (S)',
  dy_avg_weekly_demand: 'Avg Wk (D)',
  st_dmax_week: 'Dmax Wk (S)',
  dy_dmax_week: 'Dmax Wk (D)',
  total_weeks: 'Tot Wks',
  weeks_with_orders: 'Wks w/ Ord',
  weeks_with_zero_orders: 'Wks Zero',
  mode_order_qty: 'Mode Qty',
  Item_Category_Code: 'Category',
  'Product Group Code': 'Group',
  Product_SubGroup_Code: 'Subgroup',
  Recency: 'Recency',
  Frequency: 'Frequency',
  Monetary: 'Monetary',
  R_Score: 'R',
  F_Score: 'F',
  M_Score: 'M',
  RFM_Score: 'RFM',
  ABC_Quantum: 'Quantum',
  'Contribution (%)': 'Contrib %',
  'Cumulative Contribution (%)': 'Cumul %',
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '—'
    if (Number.isInteger(v)) return v.toLocaleString()
    return v.toFixed(2)
  }
  return String(v)
}

/** Return a short display value for filter dropdowns (truncate long strings). */
function filterLabel(v: unknown): string {
  const s = fmt(v)
  return s.length > 28 ? s.slice(0, 26) + '…' : s
}

/* ---------- component ---------- */

export function InventoryExplorerPage() {
  const { result } = useProcessedData()
  const [searchTerm, setSearchTerm] = useState('')
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  // ---------- columns ----------
  const columns = useMemo(() => {
    if (!result) return []
    return KEY_COLUMNS.filter((c) => result.columns.includes(c))
  }, [result])

  // ---------- unique values per column ----------
  const uniqueValuesByColumn = useMemo(() => {
    if (!result) return {} as Record<string, string[]>
    const map: Record<string, string[]> = {}
    for (const col of columns) {
      const set = new Set<string>()
      for (const row of result.data) {
        const v = fmt(row[col])
        if (v && v !== '—') set.add(v)
      }
      const sorted = [...set].sort((a, b) => {
        const na = Number(a), nb = Number(b)
        if (!isNaN(na) && !isNaN(nb)) return na - nb
        return a.localeCompare(b)
      })
      map[col] = sorted.slice(0, 100) // cap at 100 unique values per column
    }
    return map
  }, [result, columns])

  // ---------- filtered rows ----------
  const filtered = useMemo(() => {
    if (!result) return []
    let rows = result.data

    // Apply per-column filters
    const activeFilters = Object.entries(columnFilters).filter(([, v]) => v)
    if (activeFilters.length > 0) {
      rows = rows.filter((r) =>
        activeFilters.every(([col, val]) => String(r[col] ?? '') === val),
      )
    }

    // Apply global search
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase()
      rows = rows.filter((r) =>
        columns.some((c) => String(r[c] ?? '').toLowerCase().includes(q)),
      )
    }

    return rows
  }, [result, columnFilters, searchTerm, columns])

  // ---------- paginated slice ----------
  const page = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])
  const hasMore = visibleCount < filtered.length

  const handleShowMore = () => {
    setVisibleCount((prev) => prev + PAGE_SIZE)
  }

  const activeFilterCount = Object.values(columnFilters).filter(Boolean).length

  const clearAllFilters = () => {
    setColumnFilters({})
    setSearchTerm('')
    setVisibleCount(PAGE_SIZE)
  }

  // ---------- render ----------
  if (!result) {
    return (
      <div>
        <PageHeader title="Inventory Explorer" subtitle="Browse all products with full pipeline metrics." />
        <ContentCard title="No Data" description="Run the pipeline first from Overview.">
          <p className="text-sm text-muted-foreground">
            Go to <Link to="/overview" className="text-primary underline">Overview</Link> and run analysis.
          </p>
        </ContentCard>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Inventory Explorer"
        subtitle={`${result.rows.toLocaleString()} products · ${columns.length} metrics`}
      />

      <ContentCard
        title="Product Table"
        description="Each column has its own filter dropdown (like Excel). Showing first 20 by default."
      >
        {/* ---------- Toolbar ---------- */}
        <div className="mb-3 flex flex-wrap items-center gap-3">
          {/* Global search */}
          <label className="relative min-w-56">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              placeholder="Search across all columns…"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setVisibleCount(PAGE_SIZE)
              }}
              className="h-9 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-ring"
            />
          </label>

          {/* Filter stats */}
          <span className="text-xs text-muted-foreground">
            {activeFilterCount > 0 ? `${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''} active · ` : ''}
            Showing {page.length.toLocaleString()} of {filtered.length.toLocaleString()} products
          </span>

          {/* Clear all */}
          {(activeFilterCount > 0 || searchTerm) && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-muted/60"
            >
              <FilterX size={13} />
              Clear
            </button>
          )}
        </div>

        {/* ---------- Scrollable table ---------- */}
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="min-w-full border-collapse text-sm">
            {/* ---- Header row ---- */}
            <thead className="bg-muted/60">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col}
                    className="whitespace-nowrap border-b border-border px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {COL_LABELS[col] ?? col}
                  </th>
                ))}
              </tr>
            </thead>

            {/* ---- Filter row (Excel-style, one dropdown per column) ---- */}
            <thead className="bg-background">
              <tr>
                {columns.map((col) => {
                  const vals = uniqueValuesByColumn[col] ?? []
                  const current = columnFilters[col] ?? ''
                  return (
                    <th key={`filter-${col}`} className="border-b border-border px-1 py-1.5 align-top">
                      <div className="relative">
                        <select
                          value={current}
                          onChange={(e) => {
                            const next = { ...columnFilters, [col]: e.target.value }
                            if (!e.target.value) delete next[col]
                            setColumnFilters(next)
                            setVisibleCount(PAGE_SIZE)
                          }}
                          className="h-7 w-full cursor-pointer appearance-none rounded-md border border-border bg-card px-1.5 pr-5 text-[11px] outline-none focus:border-ring"
                        >
                          <option value="">All</option>
                          {vals.map((v) => (
                            <option key={v} value={v}>
                              {filterLabel(v)}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size={11}
                          className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>

            {/* ---- Body ---- */}
            <tbody>
              {page.map((row, idx) => (
                <tr key={idx} className="odd:bg-background even:bg-card/40">
                  {columns.map((col) => {
                    const isItemCode = col === 'Item_Code'
                    const val = fmt(row[col])
                    return (
                      <td
                        key={col}
                        className="whitespace-nowrap border-b border-border/60 px-2 py-1.5 text-xs text-muted-foreground"
                      >
                        {isItemCode ? (
                          <Link
                            to={`/inventory-explorer/${val}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {val}
                          </Link>
                        ) : (
                          val
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ---------- Show more / summary ---------- */}
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-xs text-muted-foreground">
            {filtered.length === 0
              ? 'No products match the current filters.'
              : `Showing ${page.length.toLocaleString()} of ${filtered.length.toLocaleString()} products`}
          </span>
          {hasMore && (
            <button
              type="button"
              onClick={handleShowMore}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/60"
            >
              Show more ({Math.min(PAGE_SIZE, filtered.length - visibleCount).toLocaleString()} more)
            </button>
          )}
        </div>
      </ContentCard>
    </div>
  )
}
