/* ---- Shared Refurbishment Budget logic ----
 *
 * Single source of truth for the Refurbishment Budget calculation so the
 * Overview executive-summary card and the SKU-level Review table always agree.
 *
 *   Refurbishment Qty = ROL − Open FG Stock  when Open FG Stock ≤ Safety Stock
 *                       (of the selected ROL basis), else 0
 *   Unit Cost         = (Monetary ÷ total sales of the selected basis) × 65%
 *   Budget            = Refurbishment Qty × Unit Cost
 */

import {
  toNumeric,
  type InventoryRecord,
} from '@/services/state/processed-data-context'

/** ROL basis used by the Refurbishment Budget. */
export type RolMode = 'static' | 'dynamic'

/** Pipeline columns used per ROL basis. */
export const REFURB_COLUMNS: Record<
  RolMode,
  { rol: string; safetyStock: string; totalSales: string }
> = {
  static: { rol: 'rol_static', safetyStock: 'st_safety_stock', totalSales: 'st_total_sales' },
  dynamic: { rol: 'rol_dynamic', safetyStock: 'dy_safety_stock', totalSales: 'dy_total_sales' },
}

export const ROL_MODE_LABELS: Record<RolMode, string> = {
  static: 'Static',
  dynamic: 'Dynamic',
}

/** Canonical risk categories, in display order. */
export const RISK_CATEGORY_ORDER = [
  'High_Risk_External',
  'Medium_Risk_External',
  'Medium_Risk_Internal',
  'Low_Risk_External',
  'Low_Risk_Internal',
] as const

export const RISK_CATEGORY_LABELS: Record<string, string> = {
  High_Risk_External: 'High Risk External',
  Medium_Risk_External: 'Medium Risk External',
  Medium_Risk_Internal: 'Medium Risk Internal',
  Low_Risk_External: 'Low Risk External',
  Low_Risk_Internal: 'Low Risk Internal',
}

export const RISK_CATEGORY_TONES: Record<string, string> = {
  High_Risk_External: 'bg-red-500',
  Medium_Risk_External: 'bg-amber-500',
  Medium_Risk_Internal: 'bg-sky-500',
  Low_Risk_External: 'bg-emerald-500',
  Low_Risk_Internal: 'bg-teal-500',
}

/** Format a monetary amount in Indian Rupees with thousands separators. */
export const inr = (v: number) => '₹' + Math.round(v).toLocaleString('en-IN')

/** Display scale for monetary values. */
export type MoneyFormat = 'full' | 'lakhs' | 'crores'

export const MONEY_FORMAT_OPTIONS: { key: MoneyFormat; label: string; title: string }[] = [
  { key: 'full', label: '₹ Full', title: 'Exact amount in Indian Rupees' },
  { key: 'lakhs', label: '₹ Lakhs', title: 'Amount in lakhs (1 L = ₹1,00,000)' },
  { key: 'crores', label: '₹ Crores', title: 'Amount in crores (1 Cr = ₹1,00,00,000)' },
]

/** Format a monetary amount at the selected display scale. */
export function formatMoney(v: number, fmt: MoneyFormat): string {
  switch (fmt) {
    case 'lakhs': {
      const lakhs = v / 1e5
      // Too small to represent in lakhs — fall back to the exact figure
      if (v > 0 && lakhs < 0.005) return inr(v)
      return `₹${lakhs.toLocaleString('en-IN', { maximumFractionDigits: 2 })} L`
    }
    case 'crores': {
      const crores = v / 1e7
      // Too small to represent in crores — fall back to the exact figure
      if (v > 0 && crores < 0.005) return inr(v)
      return `₹${crores.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`
    }
    default:
      return inr(v)
  }
}

/** One SKU row in the Refurbishment Budget — enough to re-derive every output. */
export interface RefurbishmentSku {
  itemCode: string
  itemName?: string
  riskCategory: string
  /** Open FG Stock (units). */
  openStock: number
  /** Monetary (₹) — total sales value (basis-independent). */
  monetary: number
  /** Static-basis ROL. */
  rolStatic: number
  /** Dynamic-basis ROL. */
  rolDynamic: number
  /** Static-basis Safety Stock. */
  ssStatic: number
  /** Dynamic-basis Safety Stock. */
  ssDynamic: number
  /** Static-basis total sales (units). */
  salesStatic: number
  /** Dynamic-basis total sales (units). */
  salesDynamic: number
  /** ROL of the selected basis. */
  rol: number
  /** Safety Stock of the selected basis. */
  safetyStock: number
  /** Total sales (units) of the selected basis. */
  totalSales: number
  /** Unit Cost = (Monetary ÷ total sales) × 65%. */
  unitCost: number
  /** Refurbishment Qty = ROL − Open FG Stock (0 when no replenishment needed). */
  qty: number
  /** Budget = Refurbishment Qty × Unit Cost. */
  budget: number
}

/** Per-basis calculation for a single SKU row. */
interface BasisCalc {
  rol: number
  safetyStock: number
  totalSales: number
  unitCost: number
  qty: number
  budget: number
}

function computeBasis(row: InventoryRecord, rolMode: RolMode): BasisCalc {
  const cols = REFURB_COLUMNS[rolMode]
  const open = toNumeric(row['Open FG Stock'])
  const rol = toNumeric(row[cols.rol])
  const ss = toNumeric(row[cols.safetyStock])
  const qty = open <= ss ? Math.max(0, rol - open) : 0
  const sales = toNumeric(row[cols.totalSales])
  const monetary = toNumeric(row['Monetary'])
  const unitCost = sales > 0 ? (monetary / sales) * 0.65 : 0
  return { rol, safetyStock: ss, totalSales: sales, unitCost, qty, budget: qty * unitCost }
}

/**
 * Compute the SKU-level refurbishment rows for the given ROL basis.
 * SKUs that need no replenishment (open stock above their safety stock, or a
 * non-positive shortfall) are excluded — matching the Overview card.
 *
 * Both static and dynamic inputs are carried on every row so the review table
 * can show SS (Static), SS (Dynamic), sales, and ROL side by side; the
 * basis-specific fields (``rol``, ``safetyStock``, ``totalSales``, ``unitCost``,
 * ``qty``, ``budget``) reflect ``rolMode``.
 */
export function computeRefurbishmentSkus(
  data: InventoryRecord[],
  rolMode: RolMode,
): RefurbishmentSku[] {
  const out: RefurbishmentSku[] = []
  for (const row of data) {
    const open = toNumeric(row['Open FG Stock'])
    const b = computeBasis(row, rolMode)
    if (b.qty <= 0) continue
    out.push({
      itemCode: String(row['Item_Code'] ?? ''),
      itemName: typeof row['Item_Name'] === 'string' ? row['Item_Name'] : undefined,
      riskCategory: String(row['Risk_Category'] ?? 'Unknown') || 'Unknown',
      openStock: open,
      monetary: toNumeric(row['Monetary']),
      rolStatic: toNumeric(row['rol_static']),
      rolDynamic: toNumeric(row['rol_dynamic']),
      ssStatic: toNumeric(row['st_safety_stock']),
      ssDynamic: toNumeric(row['dy_safety_stock']),
      salesStatic: toNumeric(row['st_total_sales']),
      salesDynamic: toNumeric(row['dy_total_sales']),
      rol: b.rol,
      safetyStock: b.safetyStock,
      totalSales: b.totalSales,
      unitCost: b.unitCost,
      qty: b.qty,
      budget: b.budget,
    })
  }
  return out
}

/**
 * One SKU row of the dual-basis review table — carries the refurbishment
 * output for BOTH ROL bases, plus the shared inputs.
 *
 * Sales (and therefore Unit Cost) are the same for both bases in the pipeline
 * (``st_total_sales`` == ``dy_total_sales``), so a single ``sales`` / ``unitCost``
 * is carried; the bases only differ in ROL / Safety Stock → Qty → Budget.
 */
export interface RefurbishmentSkuDual {
  itemCode: string
  itemName?: string
  riskCategory: string
  /** Open FG Stock (units). */
  openStock: number
  /** Monetary (₹) — total sales value (basis-independent). */
  monetary: number
  /** Static-basis ROL. */
  rolStatic: number
  /** Dynamic-basis ROL. */
  rolDynamic: number
  /** Static-basis Safety Stock. */
  ssStatic: number
  /** Dynamic-basis Safety Stock. */
  ssDynamic: number
  /** Total sales (units) — same for both bases. */
  sales: number
  /** Unit Cost = (Monetary ÷ sales) × 65% — same for both bases. */
  unitCost: number
  /** Refurbishment Qty under the Static ROL (0 when no replenishment needed). */
  qtyStatic: number
  /** Refurbishment Qty under the Dynamic ROL (0 when no replenishment needed). */
  qtyDynamic: number
  /** Static-basis Budget = qtyStatic × unitCost. */
  budgetStatic: number
  /** Dynamic-basis Budget = qtyDynamic × unitCost. */
  budgetDynamic: number
}

/**
 * Compute SKU-level refurbishment rows for BOTH ROL bases at once (review table).
 * A SKU is included when either basis needs replenishment; the other basis's
 * qty / budget are 0 in that case.
 */
export function computeRefurbishmentSkusDual(data: InventoryRecord[]): RefurbishmentSkuDual[] {
  const out: RefurbishmentSkuDual[] = []
  for (const row of data) {
    const st = computeBasis(row, 'static')
    const dy = computeBasis(row, 'dynamic')
    if (st.qty <= 0 && dy.qty <= 0) continue

    // Sales are the same for both bases; prefer static, fall back defensively.
    const monetary = toNumeric(row['Monetary'])
    const sales = st.totalSales > 0 ? st.totalSales : dy.totalSales
    const unitCost = sales > 0 ? (monetary / sales) * 0.65 : 0

    out.push({
      itemCode: String(row['Item_Code'] ?? ''),
      itemName: typeof row['Item_Name'] === 'string' ? row['Item_Name'] : undefined,
      riskCategory: String(row['Risk_Category'] ?? 'Unknown') || 'Unknown',
      openStock: toNumeric(row['Open FG Stock']),
      monetary,
      rolStatic: toNumeric(row['rol_static']),
      rolDynamic: toNumeric(row['rol_dynamic']),
      ssStatic: toNumeric(row['st_safety_stock']),
      ssDynamic: toNumeric(row['dy_safety_stock']),
      sales,
      unitCost,
      qtyStatic: st.qty,
      qtyDynamic: dy.qty,
      budgetStatic: st.budget,
      budgetDynamic: dy.budget,
    })
  }
  return out
}

/** Per-basis totals for the dual-basis review table. */
export interface RefurbishmentBasisSummary {
  totalSkus: number
  totalQty: number
  totalBudget: number
}

export interface RefurbishmentDualSummary {
  static: RefurbishmentBasisSummary
  dynamic: RefurbishmentBasisSummary
}

/**
 * Per-basis totals for the dual-basis review table. SKU counts only include
 * SKUs with qty > 0 in that basis (a SKU may need replenishment under only
 * one of the two bases).
 */
export function summarizeRefurbishmentDual(rows: RefurbishmentSkuDual[]): RefurbishmentDualSummary {
  let sSkus = 0
  let sQty = 0
  let sBudget = 0
  let dSkus = 0
  let dQty = 0
  let dBudget = 0
  for (const r of rows) {
    if (r.qtyStatic > 0) {
      sSkus += 1
      sQty += r.qtyStatic
      sBudget += r.budgetStatic
    }
    if (r.qtyDynamic > 0) {
      dSkus += 1
      dQty += r.qtyDynamic
      dBudget += r.budgetDynamic
    }
  }
  return {
    static: { totalSkus: sSkus, totalQty: sQty, totalBudget: sBudget },
    dynamic: { totalSkus: dSkus, totalQty: dQty, totalBudget: dBudget },
  }
}

export interface RefurbishmentCategoryRow {
  key: string
  label: string
  tone: string
  skus: number
  qty: number
  budget: number
}

export interface RefurbishmentSummary {
  rows: RefurbishmentCategoryRow[]
  totalSkus: number
  totalQty: number
  totalBudget: number
}

/** Aggregate SKU rows into the per-Risk-Category summary shown on the card. */
export function summarizeRefurbishment(skus: RefurbishmentSku[]): RefurbishmentSummary {
  const perCat = new Map<string, { skus: number; qty: number; budget: number }>()
  let totalSkus = 0
  let totalQty = 0
  let totalBudget = 0

  for (const s of skus) {
    const cur = perCat.get(s.riskCategory) ?? { skus: 0, qty: 0, budget: 0 }
    cur.skus += 1
    cur.qty += s.qty
    cur.budget += s.budget
    perCat.set(s.riskCategory, cur)
    totalSkus += 1
    totalQty += s.qty
    totalBudget += s.budget
  }

  const rows: RefurbishmentCategoryRow[] = RISK_CATEGORY_ORDER.map((key) => {
    const c = perCat.get(key)
    return {
      key,
      label: RISK_CATEGORY_LABELS[key],
      tone: RISK_CATEGORY_TONES[key],
      skus: c?.skus ?? 0,
      qty: c?.qty ?? 0,
      budget: c?.budget ?? 0,
    }
  })
  // Defensive: surface any category outside the canonical five
  for (const [key, c] of perCat) {
    if (!RISK_CATEGORY_ORDER.includes(key as (typeof RISK_CATEGORY_ORDER)[number])) {
      rows.push({
        key,
        label: RISK_CATEGORY_LABELS[key] ?? key,
        tone: 'bg-muted',
        skus: c.skus,
        qty: c.qty,
        budget: c.budget,
      })
    }
  }

  // Sort by SKU count, highest first (budget breaks any remaining tie).
  rows.sort((a, b) => b.skus - a.skus || b.budget - a.budget)

  return { rows, totalSkus, totalQty, totalBudget }
}
