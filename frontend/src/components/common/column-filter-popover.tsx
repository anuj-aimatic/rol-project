import { Check, Search, X } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { NUMERIC_OPERATORS, type NumericOp } from '@/lib/numeric-filter'

/**
 * Positioning / outside-click / header / portal shell shared by the list and
 * numeric column filter popovers. Rendered via a portal to the body so table
 * overflow clipping never hides it.
 */
function PopoverShell({
  label,
  anchorEl,
  onClose,
  children,
}: {
  label: string
  anchorEl: HTMLElement | null
  onClose: () => void
  children: ReactNode
}) {
  const popRef = useRef<HTMLDivElement>(null)

  // Close on click outside / Escape
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    // Delay so the current click doesn't immediately close
    const id = setTimeout(() => {
      document.addEventListener('click', handleClick)
      document.addEventListener('keydown', handleKey)
    }, 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('click', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

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
        <span className="text-xs font-semibold uppercase text-muted-foreground">{label}</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>
      {children}
    </div>
  )

  // Render via portal to body to avoid table overflow clipping
  return createPortal(content, document.body)
}

/**
 * Multi-select column filter popover.
 *
 * Shared by the Inventory Explorer product table and the Refurbishment Review
 * table: click a column's filter icon to open a searchable checkbox list of the
 * column's unique values.
 */
export function ColumnFilterPopover({
  label,
  values,
  selected,
  onToggle,
  onClose,
  anchorEl,
}: {
  label: string
  values: string[]
  selected: Set<string>
  onToggle: (v: string) => void
  onClose: () => void
  anchorEl: HTMLElement | null
}) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return values
    const q = search.trim().toLowerCase()
    return values.filter((v) => v.toLowerCase().includes(q))
  }, [values, search])

  const allSelected = values.length > 0 && values.every((v) => selected.has(v))
  const noneSelected = selected.size === 0

  return (
    <PopoverShell label={label} anchorEl={anchorEl} onClose={onClose}>
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
          <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">No matches</p>
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
    </PopoverShell>
  )
}

/**
 * Numeric comparison column filter popover.
 *
 * Used for int / float columns: pick a comparison operator (=, ≠, <, ≤, >, ≥)
 * and a value, then Apply. The applied filter is shown at the bottom and can be
 * cleared in place. ``=`` / ``≠`` match the 2-decimal value displayed in the
 * table; ``<`` / ``≤`` / ``>`` / ``≥`` compare the raw value.
 */
export function NumericColumnFilterPopover({
  label,
  anchorEl,
  op,
  value,
  prefix,
  applied,
  onOpChange,
  onValueChange,
  onApply,
  onClear,
  onClose,
}: {
  label: string
  anchorEl: HTMLElement | null
  op: NumericOp
  value: string
  /** Optional unit prefix shown inside the value input (e.g. ₹). */
  prefix?: string
  /** Currently applied filter on this column, if any. */
  applied: { op: NumericOp; value: number } | null
  onOpChange: (op: NumericOp) => void
  onValueChange: (v: string) => void
  onApply: () => void
  onClear: () => void
  onClose: () => void
}) {
  const parsed = parseFloat(value.replace(/[₹,]/g, '').trim())
  const canApply = !isNaN(parsed)
  const appliedOp = applied ? NUMERIC_OPERATORS.find((o) => o.key === applied.op) : null

  return (
    <PopoverShell label={label} anchorEl={anchorEl} onClose={onClose}>
      <div className="space-y-2.5 p-3">
        {/* Operator */}
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Condition
          </label>
          <select
            value={op}
            onChange={(e) => onOpChange(e.target.value as NumericOp)}
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-ring"
          >
            {NUMERIC_OPERATORS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.symbol} {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Value */}
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Value
          </label>
          <div className="relative">
            {prefix && (
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                {prefix}
              </span>
            )}
            <input
              type="text"
              inputMode="decimal"
              placeholder={prefix ? `e.g. ${prefix}5,000` : 'e.g. 5,000'}
              value={value}
              onChange={(e) => onValueChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canApply) onApply()
              }}
              className={`h-8 w-full rounded-md border border-border bg-background text-xs outline-none focus:border-ring ${
                prefix ? 'pl-7 pr-2' : 'px-2'
              }`}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={onApply}
            disabled={!canApply}
            className="h-8 flex-1 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Apply
          </button>
          {applied && (
            <button
              type="button"
              onClick={onClear}
              className="h-8 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>

        {/* Active filter summary */}
        {applied && appliedOp && (
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Active: {appliedOp.symbol} {prefix ?? ''}
            {applied.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </p>
        )}
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          = and ≠ match the 2-decimal value shown in the table.
        </p>
      </div>
    </PopoverShell>
  )
}
