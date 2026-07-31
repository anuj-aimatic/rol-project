import { AlertTriangle, Loader2 } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'

import { ContentCard } from '@/components/common/content-card'
import { PageHeader } from '@/components/common/page-header'
import { apiClient } from '@/services/api/client'
import { useProcessedData } from '@/services/state/processed-data-context'

function fmt(v: unknown, decimals = 2): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number' && Number.isFinite(v)) return v.toFixed(decimals)
  return String(v)
}

/* ---------- Types for the ROL trace ---------- */

interface FrequencyRow {
  lower: number
  upper: number
  frequency: number
  contribution: number
  cum_probability: number
  mid_point: number
  weighted_sum: number
}

interface WeeklyRecord {
  year: number
  week: number
  demand: number
}

interface DmaxDetail {
  method?: string
  formula?: string
  fraction?: number | null
  below?: { upper: number; cum_probability: number } | null
  above?: { upper: number; cum_probability: number } | null
}

interface RolStep {
  step: number
  title: string
  formula: string
  inputs: Record<string, unknown>
  result: string | number
  frequency_table?: FrequencyRow[]
  highlight_uppers?: number[]
  detail?: DmaxDetail
}

interface RolTraceBlock {
  bin_size: number
  reason: string
  result: { rol: number; safety_stock: number; d_avg_week: number; d_max_week: number }
  steps: RolStep[]
}

interface RolTrace {
  item_code: string
  service_level: number
  lead_time: number
  total_weeks: number
  weekly_records?: WeeklyRecord[]
  static: RolTraceBlock
  dynamic: RolTraceBlock
}

/* ---------- Input chips ---------- */

function InputChips({ inputs }: { inputs: Record<string, unknown> }) {
  const entries = Object.entries(inputs).filter(([, v]) => v !== null && v !== undefined)
  if (entries.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {entries.map(([k, v]) => (
        <span
          key={k}
          className="rounded-md border border-border bg-background/70 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
        >
          {k}={String(v)}
        </span>
      ))}
    </div>
  )
}

/* ---------- Weekly demand records table ---------- */

function WeeklyRecordsTable({ rows }: { rows: WeeklyRecord[] }) {
  const total = rows.reduce((sum, r) => sum + r.demand, 0)
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-border">
      <table className="min-w-full border-collapse text-xs">
        <thead className="bg-muted/60">
          <tr>
            {['Year', 'Week', 'Weekly Demand (units)'].map((h) => (
              <th
                key={h}
                className="whitespace-nowrap border-b border-border px-2 py-1 text-left font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.year}-${r.week}`} className="odd:bg-background even:bg-card/40">
              <td className="border-b border-border/60 px-2 py-1 font-mono">{r.year}</td>
              <td className="border-b border-border/60 px-2 py-1 font-mono">{r.week}</td>
              <td className="border-b border-border/60 px-2 py-1 font-mono">{r.demand}</td>
            </tr>
          ))}
          <tr className="bg-muted/40">
            <td className="px-2 py-1 text-[11px] font-semibold text-muted-foreground" colSpan={2}>
              Total (units)
            </td>
            <td className="px-2 py-1 font-mono text-xs font-semibold text-primary">
              {total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/* ---------- Frequency table ---------- */

function FrequencyTable({ rows, highlightUppers = [] }: { rows: FrequencyRow[]; highlightUppers?: number[] }) {
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-border">
      <table className="min-w-full border-collapse text-xs">
        <thead className="bg-muted/60">
          <tr>
            {['Lower', 'Upper', 'Freq', 'Contrib', 'Cum Prob', 'Mid Pt', 'Wtd Sum'].map((h) => (
              <th
                key={h}
                className="whitespace-nowrap border-b border-border px-2 py-1 text-left font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isHighlighted = highlightUppers.includes(r.upper)
            return (
              <tr
                key={`${r.lower}-${r.upper}`}
                className={
                  isHighlighted
                    ? 'bg-primary/15 font-semibold text-foreground'
                    : 'odd:bg-background even:bg-card/40'
                }
              >
                <td
                  className={`border-b border-border/60 px-2 py-1 font-mono ${
                    isHighlighted ? 'border-l-2 border-l-primary' : ''
                  }`}
                >
                  {r.lower}
                </td>
                <td
                  className={`border-b border-border/60 px-2 py-1 font-mono ${
                    isHighlighted ? 'text-primary' : ''
                  }`}
                >
                  {r.upper}
                </td>
                <td className="border-b border-border/60 px-2 py-1 font-mono">{r.frequency}</td>
                <td className="border-b border-border/60 px-2 py-1 font-mono">{r.contribution}</td>
                <td className="border-b border-border/60 px-2 py-1 font-mono">{r.cum_probability}</td>
                <td className="border-b border-border/60 px-2 py-1 font-mono">{r.mid_point}</td>
                <td className="border-b border-border/60 px-2 py-1 font-mono">{r.weighted_sum}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ---------- One calculation block (Static or Dynamic) ---------- */

function RolBlock({ label, block }: { label: string; block: RolTraceBlock }) {
  return (
    <ContentCard
      title={`${label} ROL — Step-by-step Calculation`}
      description={`${label.toLowerCase()} bin size: ${block.bin_size} · ${block.reason}`}
    >
      <ol className="relative space-y-2">
        {block.steps.map((step, idx) => {
          const isLast = idx === block.steps.length - 1
          return (
            <li key={step.step} className="relative pl-9">
              {/* connector */}
              {!isLast && (
                <span className="absolute left-[13px] top-7 h-[calc(100%-8px)] w-px bg-border" />
              )}
              {/* number bubble */}
              <span className="absolute left-0 top-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-xs font-semibold text-muted-foreground">
                {step.step}
              </span>
              <div className="rounded-xl border border-border bg-background/60 px-3 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{step.title}</p>
                  <p className="font-mono text-sm font-semibold text-primary">
                    = {String(step.result)}
                  </p>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{step.formula}</p>
                <InputChips inputs={step.inputs} />
                {step.detail && step.detail.method && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">
                      Dmax method: {step.detail.method}
                    </span>
                    {step.detail.fraction != null && (
                      <span className="ml-1">· fraction = {step.detail.fraction}</span>
                    )}
                    {step.detail.method === 'interpolation' && (
                      <span className="ml-1">· Dmax is interpolated between the two highlighted buckets (see step 4)</span>
                    )}
                  </p>
                )}
                {step.frequency_table && (
                  <div>
                    <FrequencyTable
                      rows={step.frequency_table}
                      highlightUppers={step.highlight_uppers}
                    />
                    {step.highlight_uppers && step.highlight_uppers.length > 0 && (
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-primary/40" />
                        Highlighted row(s) = the bucket(s) that determine Dmax at the service level
                      </p>
                    )}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {/* Final result banner */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          ['Final ROL', block.result.rol, 'text-primary'],
          ['Safety Stock', block.result.safety_stock, 'text-foreground'],
          ['Avg / Dmax Week', `${block.result.d_avg_week} / ${block.result.d_max_week}`, 'text-foreground'],
        ].map(([k, v, color]) => (
          <div key={String(k)} className="rounded-xl border border-border bg-background/70 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{k}</p>
            <p className={`mt-1 font-mono text-lg font-semibold ${String(color)}`}>{String(v)}</p>
          </div>
        ))}
      </div>
    </ContentCard>
  )
}

/* ---------- Static vs Dynamic — money impact scenario ---------- */

function inr(v: number): string {
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Illustrative "what happens with your money" comparison of the two ROL
 * policies. Uses avg unit price = Monetary ÷ total units to convert units to ₹.
 * Stockout model: a week is exposed when weekly demand exceeds the ROL's
 * weekly coverage (ROL ÷ 4 weeks). Clearly labeled as a decision-support model.
 */
function StaticVsDynamicScenario({ row, trace }: { row: Record<string, unknown>; trace: RolTrace | null }) {
  const totalUnits = toNum(row.st_total_sales) || toNum(row.dy_total_sales)
  const monetary = toNum(row.Monetary)
  const price = totalUnits > 0 && monetary > 0 ? monetary / totalUnits : 0

  const staticRol = toNum(row.rol_static)
  const dynamicRol = toNum(row.rol_dynamic)
  const weekly = trace?.weekly_records ?? []

  const scenario = (rol: number) => {
    const coverage = rol / 4 // weekly demand the ROL can absorb before a stockout
    let exposedWeeks = 0
    let unmetUnits = 0
    for (const w of weekly) {
      if (w.demand > coverage) {
        exposedWeeks += 1
        unmetUnits += w.demand - coverage
      }
    }
    return {
      stockValue: rol * price,
      coverage,
      exposedWeeks,
      unmetUnits,
      lostValue: unmetUnits * price,
    }
  }

  const s = scenario(staticRol)
  const d = scenario(dynamicRol)

  // The higher-ROL policy locks more capital but covers more demand — quantify the gap.
  const rolsDiffer = Math.abs(staticRol - dynamicRol) >= 0.5
  const higherRolPolicy = dynamicRol > staticRol ? 'Dynamic' : 'Static'
  const lowerRolPolicy = higherRolPolicy === 'Dynamic' ? 'Static' : 'Dynamic'
  const extraCapital = Math.abs(d.stockValue - s.stockValue)
  const avoidedLoss = Math.abs(s.lostValue - d.lostValue) // loss the higher policy avoids
  const annualFactor = weekly.length > 0 ? 52 / weekly.length : 0
  const avoidedAnnual = avoidedLoss * annualFactor // scale observed window to a year
  const carryingCost = extraCapital * 0.2 // ~20%/yr holding cost assumption
  const netBenefit = avoidedAnnual - carryingCost
  const roiPct = extraCapital > 0 ? (netBenefit / extraCapital) * 100 : 0

  const hasMoney = price > 0
  const hasWeekly = weekly.length > 0

  return (
    <div className="mt-5 rounded-xl border border-border bg-background/50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Static vs Dynamic — money impact (illustrative)
      </p>
      {hasMoney && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Avg unit price ≈ {inr(price)}/unit · Monetary {inr(monetary)} ÷ {totalUnits.toLocaleString('en-IN')}{' '}
          units sold · holding cost assumed ~20%/yr
        </p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {[
          {
            label: 'Static ROL',
            rol: staticRol,
            sc: s,
            tone: 'text-foreground',
          },
          {
            label: 'Dynamic ROL',
            rol: dynamicRol,
            sc: d,
            tone: 'text-primary',
          },
        ].map(({ label, rol, sc, tone }) => (
          <div key={label} className="rounded-xl border border-border bg-background/70 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className={`mt-1 font-mono text-lg font-semibold ${tone}`}>
              {rol} units{hasMoney ? ` ≈ ${inr(sc.stockValue)}` : ''}
            </p>
            <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
              <li>Weekly coverage ≈ {sc.coverage.toFixed(1)} units (ROL ÷ 4)</li>
              <li>
                Stockout exposure:{' '}
                {hasWeekly ? `${sc.exposedWeeks} of ${weekly.length} weeks · ${sc.unmetUnits.toFixed(1)} units` : '—'}
              </li>
              {hasMoney && hasWeekly && (
                <li>
                  Stockout cost ≈ {inr(sc.lostValue)} over {weekly.length} observed weeks
                </li>
              )}
            </ul>
          </div>
        ))}
      </div>

      {hasMoney && hasWeekly && rolsDiffer && (
        <div className="mt-3 rounded-xl border border-border bg-background/70 px-3 py-2.5 text-xs">
          <p className="mb-1 font-medium text-foreground">ROI check — {higherRolPolicy} vs {lowerRolPolicy}</p>
          <ul className="space-y-0.5 text-muted-foreground">
            <li>
              Extra working capital locked by {higherRolPolicy}:{' '}
              <strong className="text-foreground">{inr(extraCapital)}</strong>
            </li>
            <li>
              Carrying cost of that stock (~20%/yr):{' '}
              <strong className="text-foreground">−{inr(carryingCost)}/yr</strong>
            </li>
            <li>
              Stockout cost avoided by {higherRolPolicy}:{' '}
              <strong className="text-primary">+{inr(avoidedAnnual)}/yr</strong>
            </li>
            <li>
              Net benefit per year:{' '}
              <strong className={netBenefit >= 0 ? 'text-primary' : 'text-foreground'}>
                {netBenefit >= 0 ? '+' : '−'}{inr(Math.abs(netBenefit))}/yr
              </strong>
            </li>
            <li>
              ROI on the extra capital:{' '}
              <strong className="text-primary">{roiPct.toFixed(1)}%/yr</strong>
            </li>
          </ul>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {roiPct > 0 ? (
              <>
                <strong className="text-primary">Verdict:</strong> the extra ₹ locked by {higherRolPolicy} earns ≈{' '}
                <strong className="text-primary">{roiPct.toFixed(1)}% ROI</strong> per year through avoided stockout
                cost — worth it if stockouts are costly.
              </>
            ) : (
              <>
                <strong className="text-foreground">Verdict:</strong> the extra capital is not recovered by the
                stockout cost avoided — prefer {lowerRolPolicy} (lower working capital, accepting higher stockout
                exposure) unless stockout penalty is higher than modeled.
              </>
            )}
          </p>
        </div>
      )}

      {hasMoney && hasWeekly && !rolsDiffer && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Both policies arrive at the same ROL — no money trade-off for this SKU.
        </p>
      )}

      {!hasMoney && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          No monetary data for this SKU (total units or Monetary missing) — showing units only.
        </p>
      )}
      {hasMoney && !hasWeekly && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Weekly demand records not loaded yet — stockout numbers appear with the calculation trace above.
        </p>
      )}
    </div>
  )
}

/* ---------- Main page component ---------- */

export function ProductDetailPage() {
  const { itemCode } = useParams()
  const { result } = useProcessedData()

  const [trace, setTrace] = useState<RolTrace | null>(null)
  const [loadingSteps, setLoadingSteps] = useState(false)
  const [stepsError, setStepsError] = useState<string | null>(null)

  useEffect(() => {
    if (!itemCode) return
    let cancelled = false
    setLoadingSteps(true)
    setStepsError(null)
    const load = async () => {
      try {
        const res = await apiClient.get<RolTrace>(`/product/${encodeURIComponent(itemCode)}/rol-steps`)
        if (!cancelled) setTrace(res.data)
      } catch (err) {
        if (!cancelled) {
          setTrace(null)
          setStepsError(
            err && typeof err === 'object' && 'response' in err
              ? String((err as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? '')
              : 'Could not load calculation steps.',
          )
        }
      } finally {
        if (!cancelled) setLoadingSteps(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [itemCode])

  if (!result) {
    return (
      <div>
        <PageHeader title={`Product Detail: ${itemCode ?? 'Unknown'}`} subtitle="Full decision-support metrics." />
        <ContentCard title="No Data" description="Run the pipeline first.">
          <p className="text-sm text-muted-foreground">
            Go to <Link to="/overview" className="text-primary underline">Overview</Link> to process data, then
            click a product in <Link to="/inventory-explorer" className="text-primary underline">Inventory Explorer</Link>.
          </p>
        </ContentCard>
      </div>
    )
  }

  const row = result.data.find((r) => String(r.Item_Code ?? '') === itemCode)
  if (!row) {
    return (
      <div>
        <PageHeader title={`Product Detail: ${itemCode ?? 'Unknown'}`} subtitle="Item not found in dataset." />
        <ContentCard title="Not Found" description="This Item_Code does not match any processed product.">
          <Link to="/inventory-explorer" className="text-sm text-primary underline">← Back to Explorer</Link>
        </ContentCard>
      </div>
    )
  }

  const metrics: [string, string, string][] = [
    ['Classification', 'ABC Class', row.ABC_Class as string],
    ['Classification', 'RFM Category', row.RFM_Category as string],
    ['Classification', 'RFM Score', String(row.RFM_Score ?? '—')],
    ['Classification', 'Risk Category', row.Risk_Category as string],
    ['Classification', 'Product Group', fmt(row['Product Group Code'])],
    ['Classification', 'Subgroup', fmt(row.Product_SubGroup_Code)],
    ['Demand', 'Total Weeks', fmt(row.total_weeks, 0)],
    ['Demand', 'Weeks w/ Orders', fmt(row.weeks_with_orders, 0)],
    ['Demand', 'Weeks w/ Zero Orders', fmt(row.weeks_with_zero_orders, 0)],
    ['Demand', 'Mode Order Qty', fmt(row.mode_order_qty, 0)],
    ['Demand', 'Recency (days)', fmt(row.Recency, 0)],
    ['Demand', 'Frequency', fmt(row.Frequency, 0)],
    ['Demand', 'Monetary', fmt(row.Monetary, 2)],
    ['Static ROL', 'ROL (Static)', fmt(row.rol_static, 1)],
    ['Static ROL', 'Safety Stock (Static)', fmt(row.st_safety_stock, 1)],
    ['Static ROL', 'Avg Weekly (Static)', fmt(row.st_avg_weekly_demand, 1)],
    ['Static ROL', 'Dmax Week (Static)', fmt(row.st_dmax_week, 0)],
    ['Static ROL', 'Mode Weekly (Static)', fmt(row.st_mode_weekly_demand, 0)],
    ['Dynamic ROL', 'ROL (Dynamic)', fmt(row.rol_dynamic, 1)],
    ['Dynamic ROL', 'Safety Stock (Dynamic)', fmt(row.dy_safety_stock, 1)],
    ['Dynamic ROL', 'Avg Weekly (Dynamic)', fmt(row.dy_avg_weekly_demand, 1)],
    ['Dynamic ROL', 'Dmax Week (Dynamic)', fmt(row.dy_dmax_week, 0)],
    ['Dynamic ROL', 'Mode Weekly (Dynamic)', fmt(row.dy_mode_weekly_demand, 0)],
  ]

  const groups = [...new Set(metrics.map(([g]) => g))]

  return (
    <div>
      <PageHeader
        title={`Product Detail: ${itemCode}`}
        subtitle="Full decision-support metrics from ABC-RFM-Risk-ROL pipeline."
      />

      <div className="mb-4">
        <Link to="/inventory-explorer" className="text-sm text-primary hover:underline">← Back to Explorer</Link>
      </div>

      {groups.map((group) => (
        <div key={group} className="mb-4">
          <ContentCard title={group} description={`${group} metrics for this product.`}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {metrics
                .filter(([g]) => g === group)
                .map(([, label, value]) => {
                  const isRol = label.startsWith('ROL')
                  const valNum = Number(value)
                  const isHigher = isRol && !isNaN(valNum) && valNum > 0
                  return (
                    <div key={label} className="rounded-xl border border-border bg-background/70 p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                      <p
                        className={`mt-1 text-sm font-medium ${
                          isHigher ? 'text-primary' : 'text-foreground'
                        }`}
                      >
                        {value}
                      </p>
                    </div>
                  )
                })}
            </div>
          </ContentCard>
        </div>
      ))}

      {/* ---------- Step-by-step ROL calculation ---------- */}
      <div className="mb-4">
        <ContentCard
          title="ROL Calculation — Full Trace"
          description="Every input, formula, and intermediate value behind the Static and Dynamic ROL numbers — recomputed on demand for this SKU."
        >
          {loadingSteps && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
              Computing step-by-step ROL trace…
            </div>
          )}

          {!loadingSteps && stepsError && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-300">
                  Calculation trace unavailable
                </p>
                <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-400/80">
                  {stepsError || 'Run the pipeline from Overview first, then revisit this page.'}
                </p>
              </div>
            </div>
          )}

          {!loadingSteps && trace && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Service level <strong>{Math.round(trace.service_level * 100)}%</strong> · Lead time{' '}
                <strong>{trace.lead_time} wks</strong> · Total weeks{' '}
                <strong>{trace.total_weeks}</strong>
              </p>

              {/* Source data — the raw weekly rows both calculations start from */}
              {trace.weekly_records && trace.weekly_records.length > 0 && (
                <div className="rounded-xl border border-border bg-background/40 p-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Source data — Weekly demand (Order_Qty) per Year-Week
                  </p>
                  <WeeklyRecordsTable rows={trace.weekly_records} />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    The <strong>Total</strong> row above must equal the{' '}
                    <strong>Total sales</strong> shown in step 2 of each
                    calculation — this is the source both Static and Dynamic ROL
                    are computed from.
                  </p>
                </div>
              )}

              <RolBlock label="Static" block={trace.static} />
              <RolBlock label="Dynamic" block={trace.dynamic} />
            </div>
          )}

          {!loadingSteps && !trace && !stepsError && (
            <p className="py-4 text-sm text-muted-foreground">
              No calculation trace available for this item.
            </p>
          )}
        </ContentCard>
      </div>

      {/* Recommendation */}
      <ContentCard title="Recommendation" description="Actionable policy narrative based on segmentation.">
        <ul className="space-y-2 text-sm text-foreground">
          <li>
            - Inventory Priority:{' '}
            <strong>{row.ABC_Class === 'A' ? 'High' : row.ABC_Class === 'B' ? 'Medium' : 'Low'}</strong>
          </li>
          <li>
            - Demand Behavior:{' '}
            <strong>{String(row.RFM_Category ?? 'Unknown')}</strong>
          </li>
          <li>
            - Risk Exposure:{' '}
            <strong>{String(row.Risk_Category ?? 'Unknown')}</strong>
          </li>
          <li>
            - Suggested Review:{' '}
            <strong>
              {row.RFM_Category === 'Runner'
                ? 'Weekly'
                : row.RFM_Category === 'Repeater'
                  ? 'Bi-weekly'
                  : 'Monthly'}
            </strong>
          </li>
          <li>
            - ROL Comparison:{' '}
            <strong>
              Static {fmt(row.rol_static, 0)} vs Dynamic {fmt(row.rol_dynamic, 0)}
            </strong>
          </li>
        </ul>

        <StaticVsDynamicScenario row={row} trace={trace} />
      </ContentCard>
    </div>
  )
}
