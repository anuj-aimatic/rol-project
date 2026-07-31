import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  FilterX,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { ContentCard } from '@/components/common/content-card'
import { PageHeader } from '@/components/common/page-header'
import { useProcessedData } from '@/services/state/processed-data-context'

const PAGE_SIZE = 20

const MONETARY_COLS = new Set(['Monetary', 'ABC_Quantum'])

const KEY_COLUMNS = [
  'Item_Code',
  'ABC_Class',
  'RFM_Category',
  'Risk_Category',
  'rol_static',
  'rol_dynamic',
  'st_safety_stock',
  'dy_safety_stock',
  'lead_time',
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
  lead_time: 'Lead Time',
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

/* ---------- Formatting helpers ---------- */

/** Format a value for display: ₹ for monetary cols, commas, 2-decimal rounding. */
function fmt(v: unknown, col?: string): string {
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

/* ---------- Sort direction type ---------- */
type SortDir = 'asc' | 'desc' | null

/* ---------- Popover filter component ---------- */

function ColumnFilterPopover({
  col,
  values,
  selected,
  onToggle,
  onClose,
  anchorEl,
}: {
  col: string
  values: string[]
  selected: Set<string>
  onToggle: (v: string) => void
  onClose: () => void
  anchorEl: HTMLElement | null
}) {
  const popRef = useRef<HTMLDivElement>(null)
  const [search, setSearch] = useState('')

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Delay so the current click doesn't immediately close
    const id = setTimeout(() => document.addEventListener('click', handleClick), 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('click', handleClick)
    }
  }, [onClose])

  const filtered = useMemo(() => {
    if (!search.trim()) return values
    const q = search.trim().toLowerCase()
    return values.filter((v) => v.toLowerCase().includes(q))
  }, [values, search])

  const allSelected = values.length > 0 && values.every((v) => selected.has(v))
  const noneSelected = selected.size === 0

  // Position relative to anchor
  const rect = anchorEl?.getBoundingClientRect()

  const content = (
    <div
      ref={popRef}
      className="w-56 rounded-xl border border-border bg-card shadow-2xl"
      style={{
        position: 'fixed',
        top: rect ? rect.bottom + 4 : 0,
        left: rect ? Math.min(rect.left, window.innerWidth - 260) : 0,
        zIndex: 9999,
        pointerEvents: 'auto',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold uppercase text-muted-foreground">
          {COL_LABELS[col] ?? col}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>

      {/* Search */}
      <div className="border-b border-border px-2 py-1.5">
        <label className="relative block">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 w-full rounded-md border border-border bg-background pl-6 pr-2 text-xs outline-none focus:border-ring"
          />
        </label>
      </div>

      {/* Select All / Clear */}
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <button
          type="button"
          onClick={() => {
            if (allSelected) {
              values.forEach((v) => {
                if (selected.has(v)) onToggle(v)
              })
            } else {
              values.forEach((v) => {
                if (!selected.has(v)) onToggle(v)
              })
            }
          }}
          className="text-[11px] font-medium text-primary hover:underline"
        >
          {allSelected ? 'Clear All' : 'Select All'}
        </button>
        <span className="text-[10px] text-muted-foreground">
          {selected.size} / {values.length}
        </span>
      </div>

      {/* Checkbox list */}
      <div className="max-h-48 overflow-y-auto px-1 py-1">
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
            No matches
          </p>
        ) : (
          filtered.map((v) => {
            const checked = selected.has(v)
            return (
              <label
                key={v}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-muted/60 ${
                  checked ? 'bg-primary/5 font-medium text-foreground' : 'text-muted-foreground'
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                    checked
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background'
                  }`}
                >
                  {checked && <Check size={10} strokeWidth={3} />}
                </span>
                <span className="truncate">{v}</span>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(v)}
                  className="sr-only"
                />
              </label>
            )
          })
        )}
      </div>

      {/* Footer: show active count */}
      {!noneSelected && (
        <div className="border-t border-border px-3 py-1.5">
          <p className="text-[10px] text-muted-foreground">
            {selected.size} value{selected.size > 1 ? 's' : ''} selected
          </p>
        </div>
      )}
    </div>
  )

  // Render via portal to body to avoid table overflow clipping
  return createPortal(content, document.body)
}

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
  const popoverAnchorRef = useRef<Record<string, HTMLElement | null>>({})

  // ---------- columns ----------
  const columns = useMemo(() => {
    if (!result) return []
    return KEY_COLUMNS.filter((c) => result.columns.includes(c))
  }, [result])

  // ---------- unique values per column — LAZY (only computed when popover opens) ----------
  const uniqueValuesCache = useRef<Record<string, string[]>>({})
  // Clear cache when pipeline result changes (new data = new unique values)
  useEffect(() => {
    uniqueValuesCache.current = {}
  }, [result])
  const getUniqueValues = useCallback((col: string): string[] => {
    if (!result) return []
    if (uniqueValuesCache.current[col]) return uniqueValuesCache.current[col]

    const set = new Set<string>()
    for (const row of result.data) {
      const v = fmt(row[col], col)
      if (v && v !== '—') set.add(v)
    }
    const sorted = [...set].sort((a, b) => {
      const na = parseFloat(a.replace(/[₹,]/g, ''))
      const nb = parseFloat(b.replace(/[₹,]/g, ''))
      if (!isNaN(na) && !isNaN(nb)) return na - nb
      return a.localeCompare(b)
    })
    uniqueValuesCache.current[col] = sorted.slice(0, 100)
    return sorted.slice(0, 100)
  }, [result])

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
          const displayVal = fmt(r[col], col)
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
  }, [result, columnFilters, sortCol, sortDir, searchTerm, columns])

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
        subtitle={`${result.rows.toLocaleString()} products · ${columns.length} metrics`}
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
                      className="whitespace-nowrap border-b border-border px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      <div className="flex items-center gap-0.5">
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
                            setOpenPopover((prev) => (prev === col ? null : col))
                          }}
                          className={`ml-auto rounded p-0.5 transition-colors hover:bg-muted/80 ${
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
                          col={col}
                          values={getUniqueValues(col)}
                          selected={columnFilters[col] ?? new Set()}
                          onToggle={(v) => toggleFilter(col, v)}
                          onClose={() => setOpenPopover(null)}
                          anchorEl={popoverAnchorRef.current[col]}
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
                    const val = fmt(row[col], col)
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
