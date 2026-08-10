import { Activity, Info, Loader2, Table2, Upload } from 'lucide-react'
import axios from 'axios'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { ContentCard } from '@/components/common/content-card'
import { PageHeader } from '@/components/common/page-header'
import {
  computeRefurbishmentSkus,
  formatMoney,
  MONEY_FORMAT_OPTIONS,
  RISK_CATEGORY_LABELS,
  RISK_CATEGORY_ORDER,
  RISK_CATEGORY_TONES,
  ROL_MODE_LABELS,
  summarizeRefurbishment,
  type MoneyFormat,
  type RolMode,
} from '@/lib/refurbishment'
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

/* ---- Refurbishment Budget ⓘ explanation popover ---- */

function RefurbishmentInfoPopover({ mode }: { mode: RolMode }) {
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const open = hovered || pinned
  const rootRef = useRef<HTMLSpanElement>(null)
  const panelId = useId()

  // While pinned (clicked), close on outside click or Escape.
  useEffect(() => {
    if (!pinned) return
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setPinned(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinned(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [pinned])

  return (
    <span
      ref={rootRef}
      className="relative inline-flex"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label="How is the Refurbishment Budget calculated?"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={panelId}
        onClick={() => setPinned((p) => !p)}
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors ${
          open
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
      >
        <Info size={13} />
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="How is the Refurbishment Budget calculated?"
          className="absolute left-0 top-full z-50 mt-2 w-[28rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card p-4 shadow-xl"
        >
          <p className="text-sm font-semibold text-foreground">
            How is the Refurbishment Budget calculated?
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            The Refurbishment Budget estimates the working capital required to
            replenish understocked SKUs back to their recommended Reorder Level (ROL).
          </p>

          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Calculation Logic
          </p>

          <div className="mt-2 space-y-2.5">
            <div>
              <p className="text-xs font-medium text-foreground">
                Step 1 — Check whether replenishment is required
              </p>
              <div className="mt-1 space-y-0.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
                <p>If Open FG Stock &lt;= Safety Stock ({ROL_MODE_LABELS[mode]})</p>
                <p>Refurbishment Qty = ROL ({ROL_MODE_LABELS[mode]}) − Open FG Stock</p>
                <p>Otherwise Refurbishment Qty = 0</p>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-foreground">
                Step 2 — Calculate Unit Cost
              </p>
              <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
                Unit Cost = (Monetary ÷ Total Sales) × 0.65
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                where <span className="font-mono">Monetary</span> = total sales
                value, <span className="font-mono">Total Sales</span> = total units
                sold, and 65% represents the assumed inventory carrying value.
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-foreground">
                Step 3 — Calculate Refurbishment Budget
              </p>
              <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
                Refurbishment Budget = Refurbishment Qty × Unit Cost
              </p>
            </div>
          </div>

          {/* Worked example */}
          <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
              Example
            </p>
            <div className="mt-1.5 space-y-0.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
              <p>Open FG Stock = 230 units</p>
              <p>Safety Stock = 232 units</p>
              <p>ROL = 576 units</p>
              <p>Unit Cost = ₹100</p>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Since <span className="font-mono">230 &lt;= 232</span> the SKU
              requires replenishment.
            </p>
            <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
              Refurbishment Qty = 576 − 230 = 346 units
            </p>
            <p className="mt-1 font-mono text-[11px] leading-relaxed text-foreground">
              Refurbishment Budget = 346 × ₹100 = ₹34,600
            </p>
          </div>

          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Executive Summary
          </p>
          <p className="mt-3 rounded-lg border border-border bg-background/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            Use the <strong className="text-foreground">ROL basis</strong> dropdown
            at the top of this card to switch between{' '}
            <span className="font-mono">{ROL_MODE_LABELS.static}</span> and{' '}
            <span className="font-mono">{ROL_MODE_LABELS.dynamic}</span> ROL
            calculations — everything below recomputes instantly.
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            The dashboard aggregates the Refurbishment Budget for every SKU by Risk
            Category:
          </p>
          <ul className="mt-1.5 space-y-1">
            {RISK_CATEGORY_ORDER.map((key) => (
              <li
                key={key}
                className="flex items-center gap-1.5 text-xs text-foreground"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${RISK_CATEGORY_TONES[key]}`}
                />
                {RISK_CATEGORY_LABELS[key]}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            The{' '}
            <span className="font-medium text-foreground">
              Total Working Capital Required
            </span>{' '}
            is the sum of all risk-category budgets.
          </p>
        </div>
      )}
    </span>
  )
}

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
  const [cachedSheets, setCachedSheets] = useState<string[]>([])
  const [selectedSheet, setSelectedSheet] = useState(persisted.selectedSheet)
  const [serviceLevel, setServiceLevel] = useState(persisted.serviceLevel)
  const [serviceLevelMode, setServiceLevelMode] = useState<ServiceLevelMode>(persisted.serviceLevelMode)
  const [riskLevels, setRiskLevels] = useState<RiskLevels>(persisted.riskLevels)
  const [loadingSheets, setLoadingSheets] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [recomputing, setRecomputing] = useState(false)
  const [rolMode, setRolMode] = useState<RolMode>('static')
  const [moneyFormat, setMoneyFormat] = useState<MoneyFormat>('full')

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
        const res = await apiClient.get<{ sheets: string[]; cachedSheets: string[] }>('/sheets')
        const fetched = Array.isArray(res.data) ? res.data : res.data.sheets ?? []
        const cached = Array.isArray(res.data) ? [] : res.data.cachedSheets ?? []
        if (fetched.length > 0) {
          setSheets(fetched)
          setCachedSheets(cached)
          setSelectedSheet((p) => (p ? p : fetched[0]))
        }
      } catch {
        /* expected on first visit */
      }
    }
    void load()
  }, [loadingSheets, sheets.length])

  useEffect(() => {
    if (!selectedSheet || processing || loadingSheets) return
    if (!cachedSheets.includes(selectedSheet)) return
    if (result?.sheetName === selectedSheet) return

    const loadCachedSheet = async () => {
      setProcessing(true)
      try {
        const form = new FormData()
        form.append('sheet_name', selectedSheet)
        form.append('service_level', String(serviceLevel))
        form.append('lead_time', '4')
        form.append('service_level_mode', serviceLevelMode)
        form.append('risk_high_external', String(riskLevels.High_Risk_External / 100))
        form.append('risk_low_external', String(riskLevels.Low_Risk_External / 100))
        form.append('risk_medium_external', String(riskLevels.Medium_Risk_External / 100))
        form.append('risk_medium_internal', String(riskLevels.Medium_Risk_Internal / 100))

        const res = await apiClient.post<PipelineResult & { cachedSheets?: string[] }>('/process', form, {
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
        setCachedSheets(res.data.cachedSheets ?? cachedSheets)
      } catch {
        // If cached load fails, keep the current result and let the user run.
      } finally {
        setProcessing(false)
      }
    }

    void loadCachedSheet()
  }, [selectedSheet, cachedSheets, result, processing, loadingSheets, serviceLevel, serviceLevelMode, riskLevels])

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
   * their recommended ROL (Static or Dynamic, per rolMode). Derived purely
   * from existing pipeline outputs via the shared library (used identically
   * by the Refurbishment Review page), so both views always agree. */
  const refurbishment = useMemo(() => {
    if (!result || result.data.length === 0) return null
    return summarizeRefurbishment(computeRefurbishmentSkus(result.data, rolMode))
  }, [result, rolMode])

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
    setCachedSheets([])
    setSelectedSheet('')
    setResult(null)

    if (!nextFile) return

    setLoadingSheets(true)
    try {
      const form = new FormData()
      form.append('file', nextFile)
      const res = await apiClient.post<{ sheets: string[]; cachedSheets: string[] }>('/sheets', form, {
        timeout: 180_000,
      })
      const fetched = Array.isArray(res.data) ? res.data : res.data.sheets ?? []
      const cached = Array.isArray(res.data) ? [] : res.data.cachedSheets ?? []
      if (fetched.length === 0) {
        toast.error('No worksheets detected in this workbook.')
      }
      setSheets(fetched)
      setCachedSheets(cached)
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

      const res = await apiClient.post<PipelineResult & { cachedSheets?: string[] }>('/process', form, {
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
      setCachedSheets(res.data.cachedSheets ?? [])

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
      form.append('sheet_name', selectedSheet)
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

  const isSelectedSheetCached = selectedSheet !== '' && cachedSheets.includes(selectedSheet)

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
                  {file?.name ?? (sheets.length > 0 ? 'Stored in backend' : 'Choose .xlsx file')}
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
              {isSelectedSheetCached ? (
                <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
                  Stored results for this sheet are available and will be loaded automatically.
                </p>
              ) : result && selectedSheet && selectedSheet !== result.sheetName ? (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  Selected sheet differs from stored results — run Step 4 to refresh results for this sheet.
                </p>
              ) : null}
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

          {/* Refurbishment Budget — rendered above Executive Summary */}
          {refurbishment && (
            <ContentCard
              title={
                <span className="inline-flex items-center gap-1.5">
                  Refurbishment Budget
                  <RefurbishmentInfoPopover mode={rolMode} />
                </span>
              }
              description={`Working capital required to replenish understocked SKUs back to their ${ROL_MODE_LABELS[rolMode]} ROL.`}
              icon={<Activity size={18} className="text-primary" />}
              className="order-first xl:col-span-3"
            >
              {/* ROL basis selector */}
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Calculating against the{' '}
                  <span className="font-medium text-foreground">
                    {ROL_MODE_LABELS[rolMode]}
                  </span>{' '}
                  ROL.
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="refurb-rol-mode"
                      className="text-[11px] uppercase tracking-wide text-muted-foreground"
                    >
                      ROL basis
                    </label>
                    <select
                      id="refurb-rol-mode"
                      value={rolMode}
                      onChange={(e) => setRolMode(e.target.value as RolMode)}
                      className="h-8 cursor-pointer rounded-lg border border-border bg-background px-2 text-xs font-medium text-foreground outline-none focus:border-ring"
                    >
                      <option value="static">Static ROL</option>
                      <option value="dynamic">Dynamic ROL</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      id="refurb-money-format-label"
                      className="text-[11px] uppercase tracking-wide text-muted-foreground"
                    >
                      Amount
                    </span>
                    <div
                      role="group"
                      aria-labelledby="refurb-money-format-label"
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
                  </div>

                  <Link
                    to="/refurbishment-review"
                    title="Open the SKU-level table to verify every calculation for this ROL basis"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <Table2 size={13} />
                    Review SKUs
                  </Link>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-border bg-background/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Total Working Capital Required
                  </p>
                  <div className="mt-1 text-lg font-semibold text-foreground">
                    {formatMoney(refurbishment.totalBudget, moneyFormat)}
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
                        <td className="py-2 text-right font-medium">
                          {formatMoney(r.budget, moneyFormat)}
                        </td>
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
                        {formatMoney(refurbishment.totalBudget, moneyFormat)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="mt-4 rounded-lg border border-border bg-background/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                Refurbishment Qty = {ROL_MODE_LABELS[rolMode]} ROL − Open FG Stock when Open
                FG Stock ≤ {ROL_MODE_LABELS[rolMode]} Safety Stock (else 0) · Unit Cost ={' '}
                (Monetary ÷ {ROL_MODE_LABELS[rolMode]} total sales) × 65% · Budget =
                Refurbishment Qty × Unit Cost. Derived from pipeline outputs — existing ROL /
                Safety Stock / Inventory Explorer calculations are unchanged.
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
