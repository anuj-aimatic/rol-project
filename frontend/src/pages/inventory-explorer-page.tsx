import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  FilterX,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCallback, useMemo, useRef, useState } from 'react'

import { ColumnFilterPopover } from '@/components/common/column-filter-popover'
import { ContentCard } from '@/components/common/content-card'
import { PageHeader } from '@/components/common/page-header'
import { useProcessedData } from '@/services/state/processed-data-context'

const PAGE_SIZE = 20

const MONETARY_COLS = new Set([
  'Monetary',
  'ABC_Quantum',
  'Unit Cost at 65 percent (Static)',
  'Unit Cost at 65 percent (Dynamic)',
  'Static Stock Cost',
  'Dynamic Stock Cost',
  'Static Deficiate Cost',
  'Dynamic Deficiate Cost',
])

const KEY_COLUMNS = [
  'Item_Code',
  'lead_time',
  'Open FG Stock',
  'rol_dynamic',
  'rol_static',
  'total_weeks',
  'weeks_with_orders',
  'weeks_with_zero_orders',
  'mode_order_qty',
  'st_total_sales',
  'dy_safety_stock',
  'dy_avg_weekly_demand',
  'dy_dmax_week',
  'Deficiate Dynamic Stock',
  'Dynamic Deficiate Cost',
  'Inventory Turnover Month (Dynamic)',
  'st_safety_stock',
  'st_avg_weekly_demand',
  'st_dmax_week',
  'Deficiate Static Stock',
  'Static Deficiate Cost',
  'Inventory Turnover Month (Static)',
  'ABC_Class',
  'RFM_Category',
  'Risk_Category',
  'Item_Category_Code',
  'Product Group Code',
  'Product_SubGroup_Code',
  'Customer Type',
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
  service_level: 'Service Level',
  Item_Code: 'Item Code',
  ABC_Class: 'ABC',
  RFM_Category: 'RFM',
  Risk_Category: 'Risk',
  rol_static: 'ROL (S)',
  rol_dynamic: 'ROL (D)',
  st_safety_stock: 'SS (S)',
  dy_safety_stock: 'SS (D)',
  lead_time: 'Lead Time',
  st_avg_weekly_demand: 'Avg Wk (S)',
  dy_avg_weekly_demand: 'Avg Wk (D)',
  st_dmax_week: 'Dmax Wk (S)',
  dy_dmax_week: 'Dmax Wk (D)',
  'Open FG Stock': 'Open FG Stk',
  'Deficiate Static Stock': 'Deficit Stk (S)',
  'Deficiate Dynamic Stock': 'Deficit Stk (D)',
  'Unit Cost at 65 percent (Static)': 'Unit Cost 65% (S)',
  'Unit Cost at 65 percent (Dynamic)': 'Unit Cost 65% (D)',
  'Static Stock Cost': 'Stk Cost (S)',
  'Dynamic Stock Cost': 'Stk Cost (D)',
  'Static Deficiate Cost': 'Deficit Cost (S)',
  'Dynamic Deficiate Cost': 'Deficit Cost (D)',
  'Inventory Turnover Month (Dynamic)': 'Inventory Turnover Mnth (D)',
  'Inventory Turnover Month (Static)': 'Inventory Turnover Mnth (S)',
  total_weeks: 'Tot Wks',
  weeks_with_orders: 'Wks w/ Ord',
  weeks_with_zero_orders: 'Wks Zero',
  mode_order_qty: 'Mode Qty',
  st_total_sales: 'Total Sales Qty',
  Item_Category_Code: 'Category',
  'Product Group Code': 'Group',
  Product_SubGroup_Code: 'Subgroup',
  'Customer Type': 'Customer Type',
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

/* ---------- Formatting helpers ---------- */

/** Format a value for display: ₹ for monetary cols, commas, 2-decimal rounding. */
function fmt(v: unknown, col?: string): string {
  if (col === 'service_level') return fmtPct(v)
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '—'
    const rounded = Number.isInteger(v) ? v : Math.round(v * 100) / 100
    const prefix = col && MONETARY_COLS.has(col) ? '₹' : ''
    return prefix + rounded.toLocaleString('en-IN', {
      maximumFractionDigits: 2,
      minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    })
  }
  return String(v)
}

/** Numeric sort key for a row / column. */
function sortVal(r: Record<string, unknown>, col: string): number {
  const v = r[col]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return NaN
}

/** Format a service-level fraction (0.85) as a percent string (85%). */
function fmtPct(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${Math.round(n * 100)}%`
}

/* ---------- Sort direction type ---------- */
type SortDir = 'asc' | 'desc' | null

/* ---------- Main page component ---------- */

export function InventoryExplorerPage() {
  const { result } = useProcessedData()
  const [searchTerm, setSearchTerm] = useState('')
  // Multi-select filters: column -> Set of selected display strings
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({})
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  // Sort state
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)

  // Popover state
  const [openPopover, setOpenPopover] = useState<string | null>(null)
  // Anchor element of the currently-open popover (set on click, kept in state so
  // render never reads the ref directly)
  const [openAnchor, setOpenAnchor] = useState<HTMLElement | null>(null)
  const popoverAnchorRef = useRef<Record<string, HTMLElement | null>>({})

  // ---------- columns ----------
  const columns = useMemo(() => {
    if (!result) return []
    return ['service_level', ...KEY_COLUMNS.filter((c) => result.columns.includes(c))]
  }, [result])

  // Cell value for a column (handles the pseudo service_level column).
  // Prefers the per-SKU service_level emitted by the pipeline (risk-based mode
  // gives each SKU its own level) and falls back to the stored global for
  // results produced before that column existed.
  const cellValue = useCallback(
    (row: Record<string, unknown>, col: string): unknown =>
      col === 'service_level'
        ? (row.service_level as number | undefined) ?? result?.serviceLevel
        : row[col],
    [result],
  )

  // ---------- unique values for the open column — LAZY (only the open popover computes) ----------
  const openValues = useMemo(() => {
    if (!openPopover || !result) return []
    const set = new Set<string>()
    for (const row of result.data) {
      const v = fmt(cellValue(row, openPopover), openPopover)
      if (v && v !== '—') set.add(v)
    }
    const sorted = [...set].sort((a, b) => {
      const na = parseFloat(a.replace(/[₹,%]/g, ''))
      const nb = parseFloat(b.replace(/[₹,%]/g, ''))
      if (!isNaN(na) && !isNaN(nb)) return na - nb
      return a.localeCompare(b)
    })
    return sorted.slice(0, 100)
  }, [openPopover, result, cellValue])

  // ---------- sort + filter rows ----------
  const filtered = useMemo(() => {
    if (!result) return []
    let rows = [...result.data]

    // Apply per-column multi-select filters
    const activeFilters = Object.entries(columnFilters).filter(
      ([, set]) => set.size > 0,
    )
    if (activeFilters.length > 0) {
      rows = rows.filter((r) =>
        activeFilters.every(([col, selected]) => {
          const displayVal = fmt(cellValue(r, col), col)
          return selected.has(displayVal)
        }),
      )
    }

    // Apply sort
    if (sortCol && sortDir) {
      rows.sort((a, b) => {
        const va = sortVal(a, sortCol)
        const vb = sortVal(b, sortCol)
        if (!isNaN(va) && !isNaN(vb)) {
          return sortDir === 'asc' ? va - vb : vb - va
        }
        // Fall back to string comparison
        const sa = String(a[sortCol] ?? '')
        const sb = String(b[sortCol] ?? '')
        return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa)
      })
    }

    // Apply global search
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase()
      rows = rows.filter((r) =>
        columns.some((c) => String(r[c] ?? '').toLowerCase().includes(q)),
      )
    }

    return rows
  }, [result, columnFilters, sortCol, sortDir, searchTerm, columns, cellValue])

  // ---------- paginated slice ----------
  const page = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])
  const hasMore = visibleCount < filtered.length

  const handleShowMore = () => setVisibleCount((prev) => prev + PAGE_SIZE)

  // Track the last sorted column to reset direction on new column click
  const lastSortColRef = useRef<string | null>(null)

  // ---------- sort handler ----------
  const handleSort = useCallback(
    (col: string) => {
      const isNewCol = lastSortColRef.current !== col
      lastSortColRef.current = col
      setSortCol(col)
      setSortDir((prev) => {
        if (isNewCol || prev === null) return 'asc'
        if (prev === 'asc') return 'desc'
        return null
      })
      setVisibleCount(PAGE_SIZE)
    },
    [],  // stable — uses ref for isNewCol check
  )

  // ---------- filter handlers ----------
  const toggleFilter = useCallback((col: string, value: string) => {
    setColumnFilters((prev) => {
      const set = new Set(prev[col] ?? [])
      if (set.has(value)) set.delete(value)
      else set.add(value)
      const next = { ...prev, [col]: set }
      if (set.size === 0) delete next[col]
      return next
    })
    setVisibleCount(PAGE_SIZE)
  }, [])

  const activeFilterCount = useMemo(
    () =>
      Object.values(columnFilters).reduce((sum, s) => sum + s.size, 0),
    [columnFilters],
  )

  const clearAllFilters = () => {
    setColumnFilters({})
    setSearchTerm('')
    setSortCol(null)
    setSortDir(null)
    setVisibleCount(PAGE_SIZE)
    setOpenPopover(null)
    setOpenAnchor(null)
  }

  // ---------- sort icon helper ----------
  function sortIcon(col: string) {
    if (sortCol !== col || sortDir === null) {
      return <ArrowUpDown size={11} className="ml-1 shrink-0 opacity-30" />
    }
    return sortDir === 'asc' ? (
      <ArrowUp size={11} className="ml-1 shrink-0 text-primary" />
    ) : (
      <ArrowDown size={11} className="ml-1 shrink-0 text-primary" />
    )
  }

  // ---------- render ----------
  if (!result) {
    return (
      <div>
        <PageHeader
          title="Inventory Explorer"
          subtitle="Browse all products with full pipeline metrics."
        />
        <ContentCard title="No Data" description="Run the pipeline first from Overview.">
          <p className="text-sm text-muted-foreground">
            Go to{' '}
            <Link to="/overview" className="text-primary underline">
              Overview
            </Link>{' '}
            and run analysis.
          </p>
        </ContentCard>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Inventory Explorer"
        subtitle={`${result.rows.toLocaleString()} products · ${columns.length} metrics · ${
          (result.serviceLevelMode ?? 'global') === 'risk'
            ? 'Risk-based service levels'
            : `Service level ${fmtPct(result.serviceLevel)}`
        }`}
      />

      <ContentCard
        title="Product Table"
        description="Click column headers to sort · Click the filter icon to open per-column multi-select filters."
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
            {activeFilterCount > 0
              ? `${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''} active · `
              : ''}
            Showing {page.length.toLocaleString()} of {filtered.length.toLocaleString()}{' '}
            products
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
            {/* ---- Header row (sortable + filter icon) ---- */}
            <thead className="bg-muted/60">
              <tr>
                {columns.map((col) => {
                  const isSorted = sortCol === col && sortDir !== null
                  return (
                    <th
                      key={col}
                      className="whitespace-nowrap border-b border-border px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      <div className="flex items-center justify-center gap-0.5">
                        {/* Sortable label */}
                        <button
                          type="button"
                          onClick={() => handleSort(col)}
                          className={`flex items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-muted/80 ${
                            isSorted ? 'text-foreground' : ''
                          }`}
                        >
                          {COL_LABELS[col] ?? col}
                          {sortIcon(col)}
                        </button>

                        {/* Filter icon trigger */}
                        <button
                          type="button"
                          ref={(el) => {
                            popoverAnchorRef.current[col] = el
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            // Ref is read inside the click handler, then kept in state
                            setOpenAnchor(popoverAnchorRef.current[col] ?? null)
                            setOpenPopover((prev) => (prev === col ? null : col))
                          }}
                          className={`rounded p-0.5 transition-colors hover:bg-muted/80 ${
                            (columnFilters[col]?.size ?? 0) > 0
                              ? 'text-primary'
                              : 'text-muted-foreground'
                          }`}
                        >
                          <SlidersHorizontal size={11} />
                        </button>
                      </div>

                      {/* Popover */}
                      {openPopover === col && (
                        <ColumnFilterPopover
                          label={COL_LABELS[col] ?? col}
                          values={openValues}
                          selected={columnFilters[col] ?? new Set()}
                          onToggle={(v) => toggleFilter(col, v)}
                          onClose={() => setOpenPopover(null)}
                          anchorEl={openAnchor}
                        />
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>

            {/* ---- Body ---- */}
            <tbody>
              {page.map((row, idx) => (
                <tr
                  key={idx}
                  className="odd:bg-background even:bg-card/40 transition-colors hover:bg-muted/20"
                >
                  {columns.map((col) => {
                    const isItemCode = col === 'Item_Code'
                    const val = fmt(cellValue(row, col), col)
                    return (
                      <td
                        key={col}
                        className="whitespace-nowrap border-b border-border/60 px-2 py-1.5 text-center text-xs text-muted-foreground"
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
              {page.length === 0 && (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    No products match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ---------- Show more / summary ---------- */}
        {filtered.length > 0 && (
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-xs text-muted-foreground">
              Showing {page.length.toLocaleString()} of{' '}
              {filtered.length.toLocaleString()} products
            </span>
            {hasMore && (
              <button
                type="button"
                onClick={handleShowMore}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/60"
              >
                Show more (
                {Math.min(PAGE_SIZE, filtered.length - visibleCount).toLocaleString()} more)
              </button>
            )}
          </div>
        )}
      </ContentCard>
    </div>
  )
}
