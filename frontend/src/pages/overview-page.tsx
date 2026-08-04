import { Activity, Info, Loader2, Upload } from 'lucide-react'
import axios from 'axios'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { ContentCard } from '@/components/common/content-card'
import { PageHeader } from '@/components/common/page-header'
import { apiClient } from '@/services/api/client'
import {
  average,
  countBy,
  toNumeric,
  useProcessedData,
  type PipelineResult,
} from '@/services/state/processed-data-context'

const STATE_KEY = 'overview_state_v3'

type ServiceLevelMode = 'global' | 'risk'

const RISK_FIELDS = [
  { key: 'High_Risk_External', label: 'High Ext', hint: 'High Risk (External)' },
  { key: 'Low_Risk_External', label: 'Low Ext', hint: 'Low Risk (External)' },
  { key: 'Medium_Risk_External', label: 'Med Ext', hint: 'Medium Risk (External)' },
  { key: 'Medium_Risk_Internal', label: 'Med Int', hint: 'Medium Risk (Internal)' },
] as const

type RiskLevels = Record<(typeof RISK_FIELDS)[number]['key'], number>

const DEFAULT_RISK_LEVELS: RiskLevels = {
  High_Risk_External: 65,
  Low_Risk_External: 85,
  Medium_Risk_External: 65,
  Medium_Risk_Internal: 85,
}

/* ---- Refurbishment Budget (Executive Summary card) ---- */

/** Canonical risk categories, in display order. */
const RISK_CATEGORY_ORDER = [
  'High_Risk_External',
  'Medium_Risk_External',
  'Medium_Risk_Internal',
  'Low_Risk_External',
  'Low_Risk_Internal',
] as const

const RISK_CATEGORY_LABELS: Record<string, string> = {
  High_Risk_External: 'High Risk External',
  Medium_Risk_External: 'Medium Risk External',
  Medium_Risk_Internal: 'Medium Risk Internal',
  Low_Risk_External: 'Low Risk External',
  Low_Risk_Internal: 'Low Risk Internal',
}

const RISK_CATEGORY_TONES: Record<string, string> = {
  High_Risk_External: 'bg-red-500',
  Medium_Risk_External: 'bg-amber-500',
  Medium_Risk_Internal: 'bg-sky-500',
  Low_Risk_External: 'bg-emerald-500',
  Low_Risk_Internal: 'bg-teal-500',
}

/** Format a monetary amount in Indian Rupees with thousands separators. */
const inr = (v: number) => '₹' + Math.round(v).toLocaleString('en-IN')

interface LocalState {
  selectedSheet: string
  serviceLevel: number
  serviceLevelMode: ServiceLevelMode
  riskLevels: RiskLevels
}

function readState(): LocalState {
  const raw = (() => {
    try {
      return (
        localStorage.getItem(STATE_KEY) ??
        sessionStorage.getItem(STATE_KEY) ??
        sessionStorage.getItem('overview_state_v2')
      )
    } catch {
      return null
    }
  })()
  const defaults: LocalState = {
    selectedSheet: '',
    serviceLevel: 0.85,
    serviceLevelMode: 'global',
    riskLevels: DEFAULT_RISK_LEVELS,
  }
  try {
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<LocalState>
    return {
      ...defaults,
      ...parsed,
      serviceLevelMode: parsed.serviceLevelMode === 'risk' ? 'risk' : 'global',
      riskLevels: { ...DEFAULT_RISK_LEVELS, ...(parsed.riskLevels ?? {}) },
    }
  } catch {
    return defaults
  }
}

export function OverviewPage() {
  const { result, setResult } = useProcessedData()
  const persisted = readState()

  const [file, setFile] = useState<File | null>(null)
  const [fgStockFile, setFgStockFile] = useState<File | null>(null)
  const [sheets, setSheets] = useState<string[]>([])
  const [selectedSheet, setSelectedSheet] = useState(persisted.selectedSheet)
  const [serviceLevel, setServiceLevel] = useState(persisted.serviceLevel)
  const [serviceLevelMode, setServiceLevelMode] = useState<ServiceLevelMode>(persisted.serviceLevelMode)
  const [riskLevels, setRiskLevels] = useState<RiskLevels>(persisted.riskLevels)
  const [loadingSheets, setLoadingSheets] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [recomputing, setRecomputing] = useState(false)

  useEffect(() => {
    const state: LocalState = { selectedSheet, serviceLevel, serviceLevelMode, riskLevels }
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state))
    } catch {
      sessionStorage.setItem(STATE_KEY, JSON.stringify(state))
    }
  }, [selectedSheet, serviceLevel, serviceLevelMode, riskLevels])

  // Load cached sheets on mount
  useEffect(() => {
    if (sheets.length > 0 || loadingSheets) return
    const load = async () => {
      try {
        const res = await apiClient.get<string[]>('/sheets')
        if (Array.isArray(res.data) && res.data.length > 0) {
          setSheets(res.data)
          setSelectedSheet((p) => (p ? p : res.data[0]))
        }
      } catch {
        /* expected on first visit */
      }
    }
    void load()
  }, [loadingSheets, sheets.length])

  const summaryStats = useMemo(() => {
    if (!result) return null
    const d = result.data
    const abc = countBy(d, 'ABC_Class')
    const rfm = countBy(d, 'RFM_Category')
    const risk = countBy(d, 'Risk_Category')
    const avgStaticRol = average(d, 'rol_static')
    const avgDynamicRol = average(d, 'rol_dynamic')

    return {
      total: result.rows,
      weeks: toNumeric(d[0]?.total_weeks ?? 0),
      abc,
      rfm,
      risk,
      avgStaticRol,
      avgDynamicRol,
    }
  }, [result])

  /* Refurbishment Budget — working capital needed to replenish SKUs back to
   * Static ROL. Derived purely from existing pipeline outputs; this never
   * modifies the ROL, Safety Stock, or Inventory Explorer calculations. */
  const refurbishment = useMemo(() => {
    if (!result || result.data.length === 0) return null

    const perCat = new Map<string, { skus: number; qty: number; budget: number }>()
    let totalSkus = 0
    let totalQty = 0
    let totalBudget = 0

    for (const row of result.data) {
      const open = toNumeric(row['Open FG Stock'])
      const rol = toNumeric(row['rol_static'])
      const ss = toNumeric(row['st_safety_stock'])
      // Refurbishment Qty = ROL (Static) − Open FG Stock when open stock is at
      // or below Static Safety Stock; otherwise 0 (never negative).
      const qty = open <= ss ? Math.max(0, rol - open) : 0
      if (qty <= 0) continue

      // Unit Cost (Static) = (Monetary ÷ Static total sales) × 65%
      const sales = toNumeric(row['st_total_sales'])
      const unitCost = sales > 0 ? (toNumeric(row['Monetary']) / sales) * 0.65 : 0
      const budget = qty * unitCost

      const cat = String(row['Risk_Category'] ?? 'Unknown') || 'Unknown'
      const cur = perCat.get(cat) ?? { skus: 0, qty: 0, budget: 0 }
      cur.skus += 1
      cur.qty += qty
      cur.budget += budget
      perCat.set(cat, cur)
      totalSkus += 1
      totalQty += qty
      totalBudget += budget
    }

    const rows: {
      key: string
      label: string
      tone: string
      skus: number
      qty: number
      budget: number
    }[] = RISK_CATEGORY_ORDER.map((key) => {
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

    return { rows, totalSkus, totalQty, totalBudget }
  }, [result])

  const processSteps = useMemo(() => {
    const done = processing || !!result
    return [
      { label: 'Reading workbook', done: Boolean(file) || done },
      { label: 'Loading worksheet', done: Boolean(selectedSheet) || done },
      { label: 'Running ABC analysis', done: done },
      { label: 'Running RFM analysis', done: done },
      { label: 'Building segmentation', done: done },
      { label: 'Calculating ROL', done: done },
      { label: 'Preparing dashboard', done: done },
    ]
  }, [file, processing, result, selectedSheet])

  /* ---------- Handlers ---------- */

  const onFileChange = async (nextFile: File | null) => {
    setFile(nextFile)
    setSheets([])
    setSelectedSheet('')
    setResult(null)

    if (!nextFile) return

    setLoadingSheets(true)
    try {
      const form = new FormData()
      form.append('file', nextFile)
      const res = await apiClient.post<string[] | { sheets: string[] }>('/sheets', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 180_000,
      })
      const fetched = Array.isArray(res.data) ? res.data : (res.data as Record<string, string[]>).sheets ?? []
      if (fetched.length === 0) {
        toast.error('No worksheets detected in this workbook.')
      }
      setSheets(fetched)
      if (fetched.length > 0) setSelectedSheet(fetched[0])
      toast.success('Workbook uploaded. Sheets loaded.')
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.detail || err.message
        : 'Failed to read workbook.'
      toast.error(msg)
    } finally {
      setLoadingSheets(false)
    }
  }

  const onFgStockChange = (nextFile: File | null) => {
    setFgStockFile(nextFile)
    // Valuation / deficit / coverage columns depend on the FG Stock export, so
    // a new input invalidates the current results until the pipeline re-runs.
    setResult(null)
  }

  const runPipeline = async () => {
    if (!file && sheets.length === 0) {
      toast.error('Please upload an Excel workbook first.')
      return
    }
    if (!selectedSheet) {
      toast.error('Please select a worksheet.')
      return
    }

    setProcessing(true)
    try {
      const form = new FormData()
      if (file) form.append('file', file)
      if (fgStockFile) form.append('fg_stock_file', fgStockFile)
      form.append('sheet_name', selectedSheet)
      form.append('service_level', String(serviceLevel))
      form.append('lead_time', '4') // fallback — per-SKU lead time from data is used
      form.append('service_level_mode', serviceLevelMode)
      form.append('risk_high_external', String(riskLevels.High_Risk_External / 100))
      form.append('risk_low_external', String(riskLevels.Low_Risk_External / 100))
      form.append('risk_medium_external', String(riskLevels.Medium_Risk_External / 100))
      form.append('risk_medium_internal', String(riskLevels.Medium_Risk_Internal / 100))

      const res = await apiClient.post<PipelineResult>('/process', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300_000,
      })

      setResult({
        sheetName: res.data.sheetName,
        serviceLevel: res.data.serviceLevel,
        serviceLevelMode: res.data.serviceLevelMode ?? 'global',
        riskServiceLevels: res.data.riskServiceLevels ?? null,
        leadTime: res.data.leadTime,
        rows: res.data.rows,
        columns: res.data.columns,
        data: res.data.data,
        processedAt: new Date().toISOString(),
        customerAnalytics: res.data.customerAnalytics,
      })

      toast.success(`Analysis complete — ${res.data.rows.toLocaleString()} products.`)
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.detail || err.message
        : 'Processing failed.'
      toast.error(msg)
    } finally {
      setProcessing(false)
    }
  }

  /** Fast path: recompute only the ROL columns with the current service level. */
  const recomputeRol = async () => {
    if (!result) {
      toast.error('Run the full analysis once before applying a service level.')
      return
    }
    if (recomputing || processing) return

    setRecomputing(true)
    try {
      const form = new FormData()
      form.append('service_level', String(serviceLevel))
      form.append('service_level_mode', serviceLevelMode)
      form.append('risk_high_external', String(riskLevels.High_Risk_External / 100))
      form.append('risk_low_external', String(riskLevels.Low_Risk_External / 100))
      form.append('risk_medium_external', String(riskLevels.Medium_Risk_External / 100))
      form.append('risk_medium_internal', String(riskLevels.Medium_Risk_Internal / 100))

      const res = await apiClient.post<{
        rows: number
        columns: string[]
        data: PipelineResult['data']
        serviceLevel: number
        serviceLevelMode?: 'global' | 'risk'
        riskServiceLevels?: Record<string, number> | null
        leadTime: number
      }>('/recompute-rol', form, { timeout: 180_000 })

      setResult({
        ...result,
        serviceLevel: res.data.serviceLevel,
        serviceLevelMode: res.data.serviceLevelMode ?? serviceLevelMode,
        riskServiceLevels: res.data.riskServiceLevels ?? null,
        leadTime: res.data.leadTime,
        rows: res.data.rows,
        columns: res.data.columns,
        data: res.data.data,
        processedAt: new Date().toISOString(),
      })

      toast.success(
        serviceLevelMode === 'risk'
          ? `ROL recomputed with risk-based service levels — ${res.data.rows.toLocaleString()} products.`
          : `ROL recomputed at ${Math.round(res.data.serviceLevel * 100)}% — ${res.data.rows.toLocaleString()} products.`,
      )
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.detail || err.message
        : 'Recompute failed.'
      toast.error(msg)
    } finally {
      setRecomputing(false)
    }
  }

  const appliedSlPct = result ? Math.round(result.serviceLevel * 100) : null
  const inputSlPct = Math.round(serviceLevel * 100)
  const appliedMode = result?.serviceLevelMode ?? 'global'
  const appliedRisk = result?.riskServiceLevels ?? null
  const slDirty =
    result !== null &&
    (serviceLevelMode !== appliedMode ||
      (serviceLevelMode === 'global'
        ? Math.abs(serviceLevel - result.serviceLevel) > 1e-9
        : RISK_FIELDS.some(
            ({ key }) =>
              Math.abs((riskLevels[key] ?? 0) / 100 - (appliedRisk?.[key] ?? 0)) > 1e-9,
          )))

  /* ---------- Render ---------- */

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="Executive inventory briefing with ABC-RFM segmentation, risk signals, and ROL analysis."
      />

      {slDirty && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <span className="mt-0.5 text-amber-600 dark:text-amber-400">⚠</span>
          <div>
            {serviceLevelMode === 'global' ? (
              <>
                <p className="font-medium text-amber-800 dark:text-amber-300">
                  Service level changed to {inputSlPct}% — results still show{' '}
                  {appliedSlPct}%
                </p>
                <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-400/80">
                  Click <strong>Apply</strong> next to the service-level input to
                  recompute Dmax, safety stock and ROL for all products at{' '}
                  {inputSlPct}% in seconds — segmentation is unchanged. Or run the
                  full analysis again.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-amber-800 dark:text-amber-300">
                  Risk-based service levels changed — results still show the
                  previous levels
                </p>
                <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-400/80">
                  Click <strong>Apply</strong> to recompute Dmax, safety stock
                  and ROL for each SKU using its Risk Category's level in
                  seconds — segmentation is unchanged. Or run the full analysis
                  again.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Pipeline Wizard */}
      <div className="mb-6">
        <ContentCard
          title="Pipeline Wizard"
          description="Upload your Order Intake workbook, select a sheet, and run the full ABC-RFM-Risk-ROL pipeline."
          icon={<Activity size={18} className="text-primary" />}
        >
          <ol className="mb-5 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
            {processSteps.map((step, idx) => (
              <li
                key={step.label}
                className="flex items-center gap-2 rounded-xl border border-border bg-background/70 p-2"
              >
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs">
                  {step.done ? '✓' : idx + 1}
                </span>
                <span className={step.done ? 'text-foreground' : 'text-muted-foreground'}>
                  {step.label}
                </span>
              </li>
            ))}
          </ol>

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            {/* Step 1 */}
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
                Step 1: Upload workbook
              </label>
              <label className="flex h-11 cursor-pointer items-center justify-between rounded-xl border border-dashed border-border bg-background px-3 text-sm hover:bg-muted/40">
                <span className="truncate text-muted-foreground">
                  {file?.name ?? (sheets.length > 0 ? 'Cached in backend' : 'Choose .xlsx file')}
                </span>
                {loadingSheets ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                <input
                  type="file"
                  className="hidden"
                  accept=".xlsx,.xls"
                  onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>

            {/* Step 2 */}
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
                Step 2: Worksheet
              </label>
              <select
                value={selectedSheet}
                onChange={(e) => setSelectedSheet(e.target.value)}
                className="h-11 w-full cursor-pointer rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-ring disabled:cursor-not-allowed"
                disabled={loadingSheets || sheets.length === 0}
              >
                <option value="">
                  {loadingSheets
                    ? 'Loading...'
                    : sheets.length === 0
                      ? 'Upload to load sheets'
                      : 'Select sheet'}
                </option>
                {sheets.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {/* Step 3: Service level mode + level(s) */}
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
                Service level mode
              </label>
              <div className="mb-2 flex gap-1.5">
                {(['global', 'risk'] as const).map((mode) => {
                  const active = serviceLevelMode === mode
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setServiceLevelMode(mode)}
                      aria-pressed={active}
                      className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                        active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted/60'
                      }`}
                    >
                      <span
                        className={`flex h-3 w-3 items-center justify-center rounded-full border ${
                          active ? 'border-primary' : 'border-border'
                        }`}
                      >
                        {active && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                      </span>
                      {mode === 'global' ? 'Global' : 'Risk-Based'}
                    </button>
                  )
                })}
              </div>

              {serviceLevelMode === 'global' ? (
                <>
                  <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
                    Service level
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={0.01}
                      max={0.99}
                      step={0.01}
                      value={serviceLevel}
                      onChange={(e) => setServiceLevel(Number(e.target.value))}
                      className="h-11 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-ring"
                    />
                    {result && (
                      <button
                        type="button"
                        onClick={recomputeRol}
                        disabled={recomputing || processing}
                        title="Recompute Dmax, safety stock and ROL for all products at this service level — fast, segmentation unchanged"
                        className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-border px-3 text-xs font-medium hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {recomputing ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          'Apply'
                        )}
                      </button>
                    )}
                  </div>
                  {result && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      Applied:{' '}
                      <strong className="text-foreground">
                        {Math.round(result.serviceLevel * 100)}%
                      </strong>{' '}
                      · change the value and click Apply to recompute ROL
                    </p>
                  )}
                </>
              ) : (
                <>
                  <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
                    Service level by risk
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {RISK_FIELDS.map(({ key, label, hint }) => (
                      <label key={key} className="block" title={hint}>
                        <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-muted-foreground">
                          {label}
                        </span>
                        <div className="relative">
                          <input
                            type="number"
                            min={1}
                            max={99}
                            step={1}
                            value={riskLevels[key]}
                            onChange={(e) =>
                              setRiskLevels((prev) => ({
                                ...prev,
                                [key]: Number(e.target.value),
                              }))
                            }
                            className="h-9 w-full rounded-lg border border-border bg-background px-2 pr-6 text-sm outline-none focus:border-ring"
                          />
                          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                            %
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                  {result && (
                    <button
                      type="button"
                      onClick={recomputeRol}
                      disabled={recomputing || processing}
                      title="Recompute Dmax, safety stock and ROL for each SKU using its Risk Category's service level — fast, segmentation unchanged"
                      className="mt-2 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-border px-2 text-xs font-medium hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {recomputing ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        'Apply'
                      )}
                    </button>
                  )}
                  {result && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      Applied:{' '}
                      <strong className="text-foreground">Risk-Based</strong>{' '}
                      · change the values and click Apply to recompute ROL
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Step 4: Run */}
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
                &nbsp;
              </label>
              <button
                type="button"
                onClick={runPipeline}
                disabled={processing || loadingSheets}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                {processing && <Loader2 size={14} className="animate-spin" />}
                {processing ? 'Processing...' : 'Step 4: Run Analysis'}
              </button>
              {result && (
                <p className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                  ✓ {result.rows.toLocaleString()} products processed
                </p>
              )}
            </div>
          </div>

          {/* Optional: FG Stock export input */}
          <div className="mt-4 rounded-xl border border-border bg-background/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
                Optional: FG Stock export
              </label>
              {fgStockFile && (
                <button
                  type="button"
                  onClick={() => onFgStockChange(null)}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Clear file
                </button>
              )}
            </div>
            <label className="flex h-10 cursor-pointer items-center justify-between rounded-lg border border-dashed border-border bg-background px-3 text-xs hover:bg-muted/40">
              <span className="truncate text-muted-foreground">
                {fgStockFile?.name ?? 'Choose FG Stock .xlsx — falls back to the default export'}
              </span>
              <Upload size={14} />
              <input
                type="file"
                className="hidden"
                accept=".xlsx,.xls"
                onChange={(e) => onFgStockChange(e.target.files?.[0] ?? null)}
              />
            </label>
            <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
              Maps <span className="font-mono">Open FG Stock</span> per{' '}
              <span className="font-mono">Item_Code</span> for the valuation,
              deficit, and coverage columns. When omitted, the pipeline uses its
              default FG Stock export.
            </p>
          </div>
        </ContentCard>
      </div>

      {/* Executive Summary */}
      {summaryStats ? (
        <div className="grid gap-4 xl:grid-cols-3">
          <ContentCard
            title="Executive Summary"
            description="Real-time snapshot from pipeline output."
            icon={<Activity size={18} className="text-primary" />}
            className="xl:col-span-2"
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['Products Analyzed', summaryStats.total.toLocaleString()],
                ['Data Span', `${summaryStats.weeks} weeks`],
                ['Sheet', result?.sheetName ?? '—'],
                [
                  <span key="sl-mode" className="inline-flex items-center gap-1">
                    Service Level Mode
                    <span className="group relative inline-flex">
                      <Info
                        size={12}
                        className="cursor-help text-muted-foreground"
                      />
                      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 w-44 -translate-x-1/2 rounded-lg border border-border bg-card px-2 py-1.5 text-center text-[10px] font-normal leading-snug text-foreground opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
                        Each SKU uses the service level associated with its Risk
                        Category.
                      </span>
                    </span>
                  </span>,
                  result
                    ? result.serviceLevelMode === 'risk' && result.riskServiceLevels
                      ? (
                        <span className="flex flex-col items-start gap-0.5">
                          <span className="font-medium text-foreground">
                            Risk-Based
                          </span>
                          <span className="text-xs text-muted-foreground">
                            High Ext : {Math.round(result.riskServiceLevels.High_Risk_External * 100)}%
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Low Ext : {Math.round(result.riskServiceLevels.Low_Risk_External * 100)}%
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Medium Ext : {Math.round(result.riskServiceLevels.Medium_Risk_External * 100)}%
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Medium Int : {Math.round(result.riskServiceLevels.Medium_Risk_Internal * 100)}%
                          </span>
                        </span>
                      )
                      : `Global (${appliedSlPct}%)`
                    : '—',
                ],
                ['ABC — A / B / C', `${summaryStats.abc.A ?? 0} / ${summaryStats.abc.B ?? 0} / ${summaryStats.abc.C ?? 0}`],
                ['RFM — Runner / Repeat / Dormant / Slow', 
                  `${summaryStats.rfm.Runner ?? 0} / ${summaryStats.rfm.Repeater ?? 0} / ${summaryStats.rfm.Dormant ?? 0} / ${summaryStats.rfm['Slow Mover'] ?? 0}`
                ],
                [
                  'Avg Static ROL',
                  summaryStats.avgStaticRol.toFixed(1),
                ],
                [
                  'Avg Dynamic ROL',
                  summaryStats.avgDynamicRol.toFixed(1),
                ],
                ['High Risk SKUs', `${summaryStats.risk['High_Risk_External'] ?? 0} ext / ${summaryStats.risk['Medium_Risk_Internal'] ?? 0} int`],
              ].map(([k, v]) => (
                <div key={typeof k === 'string' ? k : 'sl-mode'} className="rounded-xl border border-border bg-background/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{k}</p>
                  <div className="mt-1 text-sm font-medium text-foreground">{v}</div>
                </div>
              ))}
            </div>

            {/* Persistent service-level transparency note */}
            {result && (
              <p className="mt-4 rounded-lg border border-border bg-background/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                {result.serviceLevelMode === 'risk' && result.riskServiceLevels ? (
                  <>
                    All ROL / safety-stock figures above were computed with{' '}
                    <strong className="text-foreground">risk-based service levels</strong>
                    {' '}— each SKU used the level of its Risk Category (High Ext{' '}
                    {Math.round(result.riskServiceLevels.High_Risk_External * 100)}%, Low Ext{' '}
                    {Math.round(result.riskServiceLevels.Low_Risk_External * 100)}%, Medium Ext{' '}
                    {Math.round(result.riskServiceLevels.Medium_Risk_External * 100)}%, Medium Int{' '}
                    {Math.round(result.riskServiceLevels.Medium_Risk_Internal * 100)}%).{' '}
                  </>
                ) : (
                  <>
                    All ROL / safety-stock figures above were computed at a{' '}
                    <strong className="text-foreground">{appliedSlPct}%</strong>{' '}
                    service level.{' '}
                  </>
                )}
                Low-volume items (total sales ≤ 300) use their raw max weekly demand, so their ROL is unchanged by the service
                level — the item detail page shows the full step-by-step
                calculation for any SKU.
              </p>
            )}
          </ContentCard>

          <ContentCard
            title="Inventory Health"
            description="Composite score from segmentation."
            icon={<Activity size={18} className="text-primary" />}
          >
            <div className="flex items-center gap-4">
              <div className="relative h-24 w-24 rounded-full bg-muted p-1">
                <div className="flex h-full w-full items-center justify-center rounded-full bg-background text-center">
                  <div>
                    <p className="text-2xl font-semibold text-foreground">
                      {Math.round(
                        (summaryStats.rfm.Runner ?? 0) / Math.max(summaryStats.total, 1) * 100,
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">% Runner</p>
                  </div>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  {summaryStats.rfm.Runner ?? 0} Runner products
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {summaryStats.rfm['Slow Mover'] ?? 0} Slow Movers,{' '}
                  {summaryStats.rfm.Dormant ?? 0} Dormant
                </p>
              </div>
            </div>
          </ContentCard>

          {/* Refurbishment Budget */}
          {refurbishment && (
            <ContentCard
              title="Refurbishment Budget"
              description="Working capital required to replenish understocked SKUs back to their Static ROL."
              icon={<Activity size={18} className="text-primary" />}
              className="xl:col-span-3"
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-border bg-background/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Total Working Capital Required
                  </p>
                  <div className="mt-1 text-lg font-semibold text-foreground">
                    {inr(refurbishment.totalBudget)}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-background/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    SKUs Requiring Refurbishment
                  </p>
                  <div className="mt-1 text-lg font-semibold text-foreground">
                    {refurbishment.totalSkus.toLocaleString('en-IN')}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-background/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Total Refurbishment Quantity
                  </p>
                  <div className="mt-1 text-lg font-semibold text-foreground">
                    {refurbishment.totalQty.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">units</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Risk Category</th>
                      <th className="py-2 pr-4 text-right font-medium">SKUs</th>
                      <th className="py-2 pr-4 text-right font-medium">Refurbishment Qty</th>
                      <th className="py-2 text-right font-medium">Budget (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {refurbishment.rows.map((r) => (
                      <tr
                        key={r.key}
                        className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40"
                      >
                        <td className="py-2 pr-4">
                          <span className="inline-flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${r.tone}`} />
                            {r.label}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-right text-muted-foreground">
                          {r.skus.toLocaleString('en-IN')}
                        </td>
                        <td className="py-2 pr-4 text-right text-muted-foreground">
                          {r.qty.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 text-right font-medium">{inr(r.budget)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-border bg-background/60">
                      <td className="py-2.5 pr-4 font-semibold">
                        Total Working Capital Required
                      </td>
                      <td className="py-2.5 pr-4 text-right font-semibold">
                        {refurbishment.totalSkus.toLocaleString('en-IN')}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-semibold">
                        {refurbishment.totalQty.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 text-right font-semibold text-primary">
                        {inr(refurbishment.totalBudget)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="mt-4 rounded-lg border border-border bg-background/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                Refurbishment Qty = Static ROL − Open FG Stock when Open FG Stock ≤ Static
                Safety Stock (else 0) · Unit Cost (Static) = (Monetary ÷ Static total sales) ×
                65% · Budget = Refurbishment Qty × Unit Cost (Static). Derived from pipeline
                outputs — existing ROL / Safety Stock / Inventory Explorer calculations are
                unchanged.
              </p>
            </ContentCard>
          )}
        </div>
      ) : (
        <ContentCard
          title="Waiting for Pipeline"
          description="Executive Summary unlocks after Step 4 completes."
        >
          <p className="text-sm text-muted-foreground">
            Upload a workbook, select a sheet, configure parameters, and run analysis.
          </p>
        </ContentCard>
      )}
    </div>
  )
}
