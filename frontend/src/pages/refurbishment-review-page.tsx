import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  FilterX,
  Search,
  SlidersHorizontal,
  Table2,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'

import {
  ColumnFilterPopover,
  NumericColumnFilterPopover,
} from '@/components/common/column-filter-popover'
import type { NumericOp } from '@/lib/numeric-filter'
import { ContentCard } from '@/components/common/content-card'
import { PageHeader } from '@/components/common/page-header'
import {
  computeRefurbishmentSkusDual,
  formatMoney,
  inr,
  MONEY_FORMAT_OPTIONS,
  RISK_CATEGORY_LABELS,
  RISK_CATEGORY_ORDER,
  RISK_CATEGORY_TONES,
  summarizeRefurbishmentDual,
  type MoneyFormat,
  type RefurbishmentSkuDual,
} from '@/lib/refurbishment'
import { useProcessedData } from '@/services/state/processed-data-context'

const PAGE_SIZE = 100

/** Numeric columns use comparison filters (=, ≠, <, ≤, >, ≥) instead of value lists. */
const NUMERIC_COLUMNS = new Set([
  'openStock',
  'ssStatic',
  'ssDynamic',
  'rolStatic',
  'rolDynamic',
  'monetary',
  'sales',
  'unitCost',
  'qtyStatic',
  'qtyDynamic',
  'budgetStatic',
  'budgetDynamic',
])

/** Numeric columns displayed in rupees — the comparison filter input gets a ₹ prefix. */
const MONEY_COLUMNS = new Set(['monetary', 'unitCost', 'budgetStatic', 'budgetDynamic'])

/** Number formatting for the table (commas, up to 2 decimals). */
function num(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const rounded = Math.round(v * 100) / 100
  return rounded.toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
  })
}

/** Money formatting for the table (₹ full precision, whole rupees). */
function money(v: number): string {
  return inr(v)
}

/** Money formatting for the table (₹ with up to 2 decimals, no whole-rupee rounding). */
function money2(v: number): string {
  if (!Number.isFinite(v)) return '—'
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

/**
 * Display value for a SKU field — must match what the table cell renders, so
 * per-column multi-select filters match on the exact visible text (same
 * convention as the Inventory Explorer product table).
 */
function fmtVal(s: RefurbishmentSkuDual, key: string): string {
  switch (key) {
    case 'itemCode':
      return s.itemCode
    case 'itemName':
      return s.itemName ?? '—'
    case 'riskCategory':
      return RISK_CATEGORY_LABELS[s.riskCategory] ?? s.riskCategory
    case 'openStock':
      return num(s.openStock)
    case 'ssStatic':
      return num(s.ssStatic)
    case 'ssDynamic':
      return num(s.ssDynamic)
    case 'rolStatic':
      return num(s.rolStatic)
    case 'rolDynamic':
      return num(s.rolDynamic)
    case 'monetary':
      return money(s.monetary)
    case 'sales':
      return num(s.sales)
    case 'unitCost':
      return money2(s.unitCost)
    case 'qtyStatic':
      return num(s.qtyStatic)
    case 'qtyDynamic':
      return num(s.qtyDynamic)
    case 'budgetStatic':
      return money2(s.budgetStatic)
    case 'budgetDynamic':
      return money2(s.budgetDynamic)
    default:
      return String((s as unknown as Record<string, unknown>)[key] ?? '')
  }
}

type SortDir = 'asc' | 'desc'

type SortKey = keyof RefurbishmentSkuDual

interface SortState {
  key: SortKey
  dir: SortDir
}

/** Filter wiring for a column header (icon trigger + popover). */
type ColumnFilterUi =
  | {
      kind: 'list'
      open: boolean
      values: string[]
      selected: Set<string>
      onToggleValue: (v: string) => void
      onToggleOpen: () => void
      onClose: () => void
    }
  | {
      kind: 'numeric'
      open: boolean
      op: NumericOp
      value: string
      prefix?: string
      applied: { op: NumericOp; value: number } | null
      onOpChange: (op: NumericOp) => void
      onValueChange: (v: string) => void
      onApply: () => void
      onClear: () => void
      onToggleOpen: () => void
      onClose: () => void
    }

/** Column header with sort control + Inventory-Explorer-style column filter. */
function SortTh({
  label,
  sortKey,
  sort,
  onSort,
  align = 'right',
  filter,
}: {
  label: string
  sortKey: SortKey
  sort: SortState | null
  onSort: (key: SortKey) => void
  align?: 'left' | 'right'
  filter?: ColumnFilterUi
}) {
  const active = sort?.key === sortKey
  const filterActive = filter
    ? filter.kind === 'numeric'
      ? filter.applied != null
      : filter.selected.size > 0
    : false
  // Anchor element of the filter trigger button, mirrored from the ref callback
  // into state so render never reads a ref directly
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <th
      className={`whitespace-nowrap py-2 pr-4 text-xs font-medium uppercase tracking-wide text-muted-foreground ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      <div className="inline-flex items-center gap-0.5">
        {/* Sortable label */}
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className={`flex cursor-pointer select-none items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground ${
            active ? 'text-foreground' : ''
          }`}
        >
          {label}
          {active ? (
            sort?.dir === 'asc' ? (
              <ArrowUp size={11} className="text-primary" />
            ) : (
              <ArrowDown size={11} className="text-primary" />
            )
          ) : (
            <ArrowUpDown size={11} className="opacity-30" />
          )}
        </button>

        {/* Filter icon trigger */}
        {filter && (
          <>
            <button
              type="button"
              ref={setAnchor}
              onClick={(e) => {
                e.stopPropagation()
                filter.onToggleOpen()
              }}
              aria-label={`Filter ${label}`}
              title="Filter column"
              className={`rounded p-0.5 transition-colors hover:bg-muted/80 ${
                filterActive ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <SlidersHorizontal size={11} />
            </button>

            {/* Popover */}
            {filter.open &&
              (filter.kind === 'numeric' ? (
                <NumericColumnFilterPopover
                  label={label}
                  anchorEl={anchor}
                  op={filter.op}
                  value={filter.value}
                  prefix={filter.prefix}
                  applied={filter.applied}
                  onOpChange={filter.onOpChange}
                  onValueChange={filter.onValueChange}
                  onApply={filter.onApply}
                  onClear={filter.onClear}
                  onClose={filter.onClose}
                />
              ) : (
                <ColumnFilterPopover
                  label={label}
                  values={filter.values}
                  selected={filter.selected}
                  onToggle={filter.onToggleValue}
                  onClose={filter.onClose}
                  anchorEl={anchor}
                />
              ))}
          </>
        )}
      </div>
    </th>
  )
}

export function RefurbishmentReviewPage() {
  const { result } = useProcessedData()

  const [moneyFormat, setMoneyFormat] = useState<MoneyFormat>('full')
  // Empty set = all risk categories selected
  const [excludedRisk, setExcludedRisk] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortState | null>({ key: 'budgetStatic', dir: 'desc' })
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  // Per-column multi-select filters (Inventory Explorer style) for text columns
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({})
  // Per-column numeric comparison filters (=, ≠, <, ≤, >, ≥) for numeric columns
  const [numericFilters, setNumericFilters] = useState<
    Record<string, { op: NumericOp; value: number }>
  >({})
  // Draft (operator + typed value) of the currently-open numeric filter popover
  const [numericDraft, setNumericDraft] = useState<{
    key: string
    op: NumericOp
    value: string
  } | null>(null)
  const [openPopover, setOpenPopover] = useState<string | null>(null)

  /* ---- SKU-level rows for BOTH ROL bases, from the same logic as the Overview card ---- */
  const skus = useMemo(() => {
    if (!result) return []
    return computeRefurbishmentSkusDual(result.data)
  }, [result])

  /* ---- Available risk categories (canonical order first, then any extras) ---- */
  const riskOptions = useMemo(() => {
    const present = new Set(skus.map((s) => s.riskCategory))
    const canonical = RISK_CATEGORY_ORDER.filter((k) => present.has(k))
    const extras = [...present].filter((k) => !RISK_CATEGORY_ORDER.some((c) => c === k))
    return [...canonical, ...extras]
  }, [skus])

  /* ---- Unique values for the currently-open column (lazy: only the open popover computes) ---- */
  const openValues = useMemo(() => {
    if (!openPopover || skus.length === 0 || NUMERIC_COLUMNS.has(openPopover)) return []
    const set = new Set<string>()
    for (const s of skus) {
      const v = fmtVal(s, openPopover)
      if (v && v !== '—') set.add(v)
    }
    const sorted = [...set].sort((a, b) => {
      const na = parseFloat(a.replace(/[₹,%]/g, ''))
      const nb = parseFloat(b.replace(/[₹,%]/g, ''))
      if (!isNaN(na) && !isNaN(nb)) return na - nb
      return a.localeCompare(b)
    })
    return sorted.slice(0, 100)
  }, [openPopover, skus])

  /* ---- Filter + sort ---- */
  const filtered = useMemo(() => {
    let rows = [...skus]

    // Risk chips (exclude-based)
    if (excludedRisk.size > 0) {
      rows = rows.filter((s) => !excludedRisk.has(s.riskCategory))
    }

    // Per-column multi-select filters (match on the exact displayed value)
    const activeFilters = Object.entries(columnFilters).filter(([, set]) => set.size > 0)
    if (activeFilters.length > 0) {
      rows = rows.filter((r) =>
        activeFilters.every(([col, selected]) => selected.has(fmtVal(r, col))),
      )
    }

    // Numeric comparison filters — compare the raw column value (= / ≠ match the
    // 2-decimal value shown in the table; < ≤ > ≥ compare raw values)
    const activeNumeric = Object.entries(numericFilters)
    if (activeNumeric.length > 0) {
      rows = rows.filter((r) =>
        activeNumeric.every(([col, f]) => {
          const raw = r[col as keyof RefurbishmentSkuDual] as number
          switch (f.op) {
            case 'eq':
              return Math.round(raw * 100) / 100 === Math.round(f.value * 100) / 100
            case 'neq':
              return Math.round(raw * 100) / 100 !== Math.round(f.value * 100) / 100
            case 'lt':
              return raw < f.value
            case 'lte':
              return raw <= f.value
            case 'gt':
              return raw > f.value
            case 'gte':
              return raw >= f.value
            default:
              return true
          }
        }),
      )
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter(
        (s) =>
          s.itemCode.toLowerCase().includes(q) ||
          (s.itemName ?? '').toLowerCase().includes(q) ||
          s.riskCategory.toLowerCase().includes(q),
      )
    }

    if (sort) {
      rows.sort((a, b) => {
        const va = a[sort.key] as number | string
        const vb = b[sort.key] as number | string
        let cmp: number
        if (typeof va === 'number' && typeof vb === 'number') {
          cmp = va - vb
        } else {
          cmp = String(va).localeCompare(String(vb))
        }
        return sort.dir === 'asc' ? cmp : -cmp
      })
    }

    return rows
  }, [skus, excludedRisk, columnFilters, numericFilters, search, sort])

  const page = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])
  const hasMore = visibleCount < filtered.length

  const summary = useMemo(() => summarizeRefurbishmentDual(filtered), [filtered])

  const activeFilterCount = useMemo(
    () =>
      excludedRisk.size +
      (search.trim() ? 1 : 0) +
      Object.values(columnFilters).reduce((sum, set) => sum + set.size, 0) +
      Object.keys(numericFilters).length,
    [excludedRisk, search, columnFilters, numericFilters],
  )
  const allRiskSelected = excludedRisk.size === 0

  const showItemName = result?.columns.includes('Item_Name') ?? false
  // Columns before the trailing 5 output columns (Unit Cost, Qty ×2, Budget ×2):
  // Item Code (+Name) Risk OpenFG SS(×2) ROL(×2) Monetary Sales
  const leadingColSpan = (showItemName ? 1 : 0) + 9

  /* ---- Column filter helpers ---- */
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

  /** Filter UI wiring for a column — value lists for text columns, comparison for numeric. */
  const filterUi = (key: string): ColumnFilterUi => {
    // Numeric columns: comparison filter with an operator + value draft
    if (NUMERIC_COLUMNS.has(key)) {
      const applied = numericFilters[key] ?? null
      const draft = numericDraft?.key === key ? numericDraft : null
      return {
        kind: 'numeric',
        open: openPopover === key,
        op: draft?.op ?? applied?.op ?? 'gte',
        value: draft?.value ?? (applied ? String(applied.value) : ''),
        prefix: MONEY_COLUMNS.has(key) ? '₹' : undefined,
        applied,
        onOpChange: (op) => setNumericDraft((prev) => ({ key, op, value: prev?.value ?? '' })),
        onValueChange: (v) =>
          setNumericDraft((prev) => ({ key, op: prev?.op ?? applied?.op ?? 'gte', value: v })),
        onApply: () => {
          const d = numericDraft
          if (!d || d.key !== key) return
          const parsed = parseFloat(d.value.replace(/[₹,]/g, '').trim())
          if (isNaN(parsed)) return
          setNumericFilters((prev) => ({ ...prev, [key]: { op: d.op, value: parsed } }))
          setNumericDraft(null)
          setOpenPopover(null)
          setVisibleCount(PAGE_SIZE)
        },
        onClear: () => {
          setNumericFilters((prev) => {
            const next = { ...prev }
            delete next[key]
            return next
          })
          setNumericDraft({ key, op: 'gte', value: '' })
          setVisibleCount(PAGE_SIZE)
        },
        onToggleOpen: () => {
          const next = openPopover === key ? null : key
          if (next === key) {
            const a = numericFilters[key]
            setNumericDraft(
              a ? { key, op: a.op, value: String(a.value) } : { key, op: 'gte', value: '' },
            )
          } else {
            setNumericDraft(null)
          }
          setOpenPopover(next)
        },
        onClose: () => {
          setNumericDraft(null)
          setOpenPopover(null)
        },
      }
    }

    // Text columns: multi-select value list (unique values computed only when open)
    return {
      kind: 'list',
      open: openPopover === key,
      values: openPopover === key ? openValues : [],
      selected: columnFilters[key] ?? new Set(),
      onToggleValue: (v) => toggleFilter(key, v),
      onToggleOpen: () => setOpenPopover((prev) => (prev === key ? null : key)),
      onClose: () => setOpenPopover(null),
    }
  }

  /* ---- CSV export ---- */
  const exportCsv = () => {
    if (filtered.length === 0) return
    const headers = [
      'Item Code',
      'Item Name',
      'Risk Category',
      'Open FG Stock',
      'Safety Stock (Static)',
      'Safety Stock (Dynamic)',
      'ROL (Static)',
      'ROL (Dynamic)',
      'Monetary (Rs)',
      'Sales Qty',
      'Unit Cost (Rs)',
      'Refurbishment Qty (Static)',
      'Refurbishment Qty (Dynamic)',
      'Budget (Rs) - Static',
      'Budget (Rs) - Dynamic',
    ]
    const lines = filtered.map((s) =>
      [
        s.itemCode,
        s.itemName ?? '',
        s.riskCategory,
        s.openStock,
        s.ssStatic,
        s.ssDynamic,
        s.rolStatic,
        s.rolDynamic,
        s.monetary,
        s.sales,
        s.unitCost,
        s.qtyStatic,
        s.qtyDynamic,
        s.budgetStatic,
        s.budgetDynamic,
      ]
        .map((v) => {
          const str = String(v ?? '')
          if (!/[",\n]/.test(str)) return str
          return '"' + str.replace(/"/g, '""') + '"'
        })
        .join(','),
    )
    const blob = new Blob([[headers.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8;',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `refurbishment-review-${result?.sheetName ?? 'sheet'}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success(`${filtered.length.toLocaleString('en-IN')} SKUs exported to CSV.`)
  }

  const toggleRisk = (key: string) => {
    setExcludedRisk((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    setVisibleCount(PAGE_SIZE)
  }

  const clearAll = () => {
    setExcludedRisk(new Set())
    setSearch('')
    setSort(null)
    setColumnFilters({})
    setNumericFilters({})
    setNumericDraft(null)
    setOpenPopover(null)
    setVisibleCount(PAGE_SIZE)
  }

  const handleSort = (key: SortKey) => {
    setSort((prev) => {
      if (prev?.key === key) {
        return prev.dir === 'asc' ? { key, dir: 'desc' } : null
      }
      return { key, dir: 'desc' }
    })
    setVisibleCount(PAGE_SIZE)
  }

  /* ---- Empty / no-data states ---- */
  if (!result) {
    return (
      <div>
        <PageHeader
          title="Refurbishment Review"
          subtitle="SKU-level verification of the Refurbishment Budget."
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

  if (skus.length === 0) {
    return (
      <div>
        <PageHeader
          title="Refurbishment Review"
          subtitle="SKU-level verification of the Refurbishment Budget."
        />
        <ContentCard
          title="No SKUs Requiring Refurbishment"
          description="Against the Static and Dynamic ROL bases."
        >
          <p className="text-sm text-muted-foreground">
            No SKU has an open FG stock at or below its safety stock under either ROL basis.
          </p>
        </ContentCard>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Refurbishment Review"
        subtitle="SKU-level table behind the Refurbishment Budget"
        actions={
          <Link
            to="/overview"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            ← Back to Overview
          </Link>
        }
      />

      <ContentCard
        title={
          <span className="inline-flex items-center gap-2">
            <Table2 size={16} className="text-primary" />
            Refurbishment Detail
          </span>
        }
        // description="Every SKU that requires replenishment under either ROL basis, with the inputs and outputs of the calculation. Click the sliders icon in any column header to filter: text columns open a value list, numeric columns support comparison (=, ≠, <, ≤, >, ≥)."
      >
        {/* ---- Toolbar ---- */}
        <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto]">
          {/* Search */}
          <label className="relative min-w-52">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              name="refurb-search"
              placeholder="Search item code / name…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setVisibleCount(PAGE_SIZE)
              }}
              className="h-9 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-ring"
            />
          </label>

          {/* Money format + export */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Totals
            </span>
            <div
              role="group"
              aria-label="Money format for totals"
              className="flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5"
            >
              {MONEY_FORMAT_OPTIONS.map((opt) => {
                const active = moneyFormat === opt.key
                return (
                  <button
                    key={opt.key}
                    type="button"
                    title={opt.title}
                    aria-pressed={active}
                    onClick={() => setMoneyFormat(opt.key)}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>

            <button
              type="button"
              onClick={exportCsv}
              disabled={filtered.length === 0}
              title="Download the filtered rows as CSV"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-background px-3 text-xs font-medium hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={13} />
              Export CSV
            </button>
          </div>
        </div>

        {/* ---- Risk category chips ---- */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            Risk
          </span>
          <button
            type="button"
            onClick={() => setExcludedRisk(new Set())}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              allRiskSelected
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground hover:bg-muted/60'
            }`}
          >
            All
          </button>
          {riskOptions.map((key) => {
            const active = !excludedRisk.has(key)
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleRisk(key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? 'border-border bg-background text-foreground hover:bg-muted/60'
                    : 'border-border bg-muted text-muted-foreground opacity-60 hover:opacity-100'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${RISK_CATEGORY_TONES[key] ?? 'bg-muted-foreground'}`}
                />
                {RISK_CATEGORY_LABELS[key] ?? key}
              </button>
            )
          })}

          {(activeFilterCount > 0 || sort != null) && (
            <button
              type="button"
              onClick={clearAll}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-muted/60"
            >
              <FilterX size={13} />
              Clear ({activeFilterCount})
            </button>
          )}
        </div>

        {/* ---- Live totals strip (Static & Dynamic) ---- */}
        <div className="mb-4 grid gap-3 lg:grid-cols-2">
          {(
            [
              { key: 'static', label: 'Static ROL' },
              { key: 'dynamic', label: 'Dynamic ROL' },
            ] as const
          ).map(({ key, label }) => {
            const s = summary[key]
            return (
              <div key={key} className="rounded-xl border border-border bg-background/70 p-3">
                <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      key === 'static' ? 'bg-sky-500' : 'bg-violet-500'
                    }`}
                  />
                  {label}
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      SKUs Requiring Refurbishment
                    </p>
                    <div className="mt-1 text-lg font-semibold text-foreground">
                      {s.totalSkus.toLocaleString('en-IN')}
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Total Refurbishment Quantity
                    </p>
                    <div className="mt-1 text-lg font-semibold text-foreground">
                      {s.totalQty.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">units</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Total Working Capital Required
                    </p>
                    <div className="mt-1 text-lg font-semibold text-primary">
                      {formatMoney(s.totalBudget, moneyFormat)}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <p className="mb-4 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          {allRiskSelected && !search.trim() && activeFilterCount === 0
            ? 'Totals match the Refurbishment Budget card on Overview for both the Static and Dynamic ROL bases.'
            : `Totals are recomputed live for the current filter selection (${filtered.length.toLocaleString('en-IN')} SKUs).`}{' '}
          Unit Cost = (Monetary ÷ Sales Qty) × 65% · Refurbishment Qty = ROL − Open FG Stock when
          Open FG Stock ≤ Safety Stock (else 0) — computed for both the Static and Dynamic ROL
          bases.
        </p>

        {/* ---- Table ---- */}
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-muted/60">
              <tr className="border-b border-border">
                <SortTh
                  label="Item Code"
                  sortKey="itemCode"
                  sort={sort}
                  onSort={handleSort}
                  align="left"
                  filter={filterUi('itemCode')}
                />
                {showItemName && (
                  <SortTh
                    label="Item Name"
                    sortKey="itemName"
                    sort={sort}
                    onSort={handleSort}
                    align="left"
                    filter={filterUi('itemName')}
                  />
                )}
                <SortTh
                  label="Risk Category"
                  sortKey="riskCategory"
                  sort={sort}
                  onSort={handleSort}
                  align="left"
                  filter={filterUi('riskCategory')}
                />
                <SortTh
                  label="Open FG Stock"
                  sortKey="openStock"
                  sort={sort}
                  onSort={handleSort}
                  filter={filterUi('openStock')}
                />
                <SortTh
                  label="SS (Static)"
                  sortKey="ssStatic"
                  sort={sort}
                  onSort={handleSort}
                  filter={filterUi('ssStatic')}
                />
                <SortTh
                  label="SS (Dynamic)"
                  sortKey="ssDynamic"
                  sort={sort}
                  onSort={handleSort}
                  filter={filterUi('ssDynamic')}
                />
                <SortTh
                  label="ROL (Static)"
                  sortKey="rolStatic"
                  sort={sort}
                  onSort={handleSort}
                  filter={filterUi('rolStatic')}
                />
                <SortTh
                  label="ROL (Dynamic)"
                  sortKey="rolDynamic"
                  sort={sort}
                  onSort={handleSort}
                  filter={filterUi('rolDynamic')}
                />
                <SortTh
                  label="Monetary (₹)"
                  sortKey="monetary"
                  sort={sort}
                  onSort={handleSort}
                  filter={filterUi('monetary')}
                />
                <SortTh
                  label="Sales Qty"
                  sortKey="sales"
                  sort={sort}
                  onSort={handleSort}
                  filter={filterUi('sales')}
                />
                <SortTh
                  label="Unit Cost (₹)"
                  sortKey="unitCost"
                  sort={sort}
                  onSort={handleSort}
                  filter={filterUi('unitCost')}
                />
                <SortTh
                  label="Refurb Qty (Static)"
                  sortKey="qtyStatic"
                  sort={sort}
                  onSort={handleSort}
                  filter={filterUi('qtyStatic')}
                />
                <SortTh
                  label="Refurb Qty (Dynamic)"
                  sortKey="qtyDynamic"
                  sort={sort}
                  onSort={handleSort}
                  filter={filterUi('qtyDynamic')}
                />
                <SortTh
                  label="Budget ₹ (Static)"
                  sortKey="budgetStatic"
                  sort={sort}
                  onSort={handleSort}
                  filter={filterUi('budgetStatic')}
                />
                <SortTh
                  label="Budget ₹ (Dynamic)"
                  sortKey="budgetDynamic"
                  sort={sort}
                  onSort={handleSort}
                  filter={filterUi('budgetDynamic')}
                />
              </tr>
            </thead>
            <tbody>
              {page.map((s, idx) => (
                <tr
                  key={s.itemCode + idx}
                  className="border-b border-border/60 last:border-0 odd:bg-background even:bg-card/40 transition-colors hover:bg-muted/20"
                >
                  <td className="whitespace-nowrap py-2 pr-4">
                    <Link
                      to={`/inventory-explorer/${s.itemCode}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {s.itemCode}
                    </Link>
                  </td>
                  {showItemName && (
                    <td className="whitespace-nowrap py-2 pr-4 text-xs text-muted-foreground">
                      {s.itemName ?? '—'}
                    </td>
                  )}
                  <td className="whitespace-nowrap py-2 pr-4">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${RISK_CATEGORY_TONES[s.riskCategory] ?? 'bg-muted-foreground'}`}
                      />
                      {RISK_CATEGORY_LABELS[s.riskCategory] ?? s.riskCategory}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 text-right text-xs text-muted-foreground">
                    {num(s.openStock)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 text-right text-xs text-muted-foreground">
                    {num(s.ssStatic)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 text-right text-xs text-muted-foreground">
                    {num(s.ssDynamic)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 text-right text-xs text-muted-foreground">
                    {num(s.rolStatic)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 text-right text-xs text-muted-foreground">
                    {num(s.rolDynamic)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 text-right text-xs text-muted-foreground">
                    {money(s.monetary)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 text-right text-xs text-muted-foreground">
                    {num(s.sales)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 text-right text-xs text-muted-foreground">
                    {money2(s.unitCost)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 text-right text-xs text-muted-foreground">
                    {num(s.qtyStatic)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 text-right text-xs text-muted-foreground">
                    {num(s.qtyDynamic)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 text-right text-xs font-semibold text-foreground">
                    {money2(s.budgetStatic)}
                  </td>
                  <td className="whitespace-nowrap py-2 text-right text-xs font-semibold text-foreground">
                    {money2(s.budgetDynamic)}
                  </td>
                </tr>
              ))}
              {page.length === 0 && (
                <tr>
                  <td
                    colSpan={leadingColSpan + 5}
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    No SKUs match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-background/60">
                  <td className="py-2.5 pr-4 font-semibold" colSpan={leadingColSpan}>
                    Total ({filtered.length.toLocaleString('en-IN')} SKUs, both bases)
                  </td>
                  <td className="py-2.5 pr-4" title="Unit Cost" />
                  <td
                    className="py-2.5 pr-4 text-right font-semibold text-foreground"
                    title="Refurbishment Qty (Static)"
                  >
                    {num(summary.static.totalQty)}
                  </td>
                  <td
                    className="py-2.5 pr-4 text-right font-semibold text-foreground"
                    title="Refurbishment Qty (Dynamic)"
                  >
                    {num(summary.dynamic.totalQty)}
                  </td>
                  <td
                    className="py-2.5 pr-4 text-right font-semibold text-primary"
                    title="Budget ₹ (Static)"
                  >
                    {moneyFormat === 'full'
                      ? money2(summary.static.totalBudget)
                      : formatMoney(summary.static.totalBudget, moneyFormat)}
                  </td>
                  <td
                    className="py-2.5 text-right font-semibold text-primary"
                    title="Budget ₹ (Dynamic)"
                  >
                    {moneyFormat === 'full'
                      ? money2(summary.dynamic.totalBudget)
                      : formatMoney(summary.dynamic.totalBudget, moneyFormat)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* ---- Pagination ---- */}
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-xs text-muted-foreground">
            Showing {page.length.toLocaleString('en-IN')} of{' '}
            {filtered.length.toLocaleString('en-IN')} SKUs
          </span>
          {hasMore && (
            <button
              type="button"
              onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/60"
            >
              Show more ({Math.min(PAGE_SIZE, filtered.length - visibleCount).toLocaleString('en-IN')} more)
            </button>
          )}
        </div>
      </ContentCard>
    </div>
  )
}
