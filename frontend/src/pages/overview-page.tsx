import { Activity, Loader2, Upload } from 'lucide-react'
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

const STATE_KEY = 'overview_state_v2'

interface LocalState {
  selectedSheet: string
  serviceLevel: number
  leadTime: number
}

function readState(): LocalState {
  try {
    const raw = sessionStorage.getItem(STATE_KEY)
    if (!raw) return { selectedSheet: '', serviceLevel: 0.85, leadTime: 4 }
    return JSON.parse(raw) as LocalState
  } catch {
    return { selectedSheet: '', serviceLevel: 0.85, leadTime: 4 }
  }
}

export function OverviewPage() {
  const { result, setResult } = useProcessedData()
  const persisted = readState()

  const [file, setFile] = useState<File | null>(null)
  const [sheets, setSheets] = useState<string[]>([])
  const [selectedSheet, setSelectedSheet] = useState(persisted.selectedSheet)
  const [serviceLevel, setServiceLevel] = useState(persisted.serviceLevel)
  const [leadTime, setLeadTime] = useState(persisted.leadTime)
  const [loadingSheets, setLoadingSheets] = useState(false)
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    sessionStorage.setItem(STATE_KEY, JSON.stringify({ selectedSheet, serviceLevel, leadTime }))
  }, [selectedSheet, serviceLevel, leadTime])

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
      form.append('sheet_name', selectedSheet)
      form.append('service_level', String(serviceLevel))
      form.append('lead_time', String(leadTime))

      const res = await apiClient.post<PipelineResult>('/process', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300_000,
      })

      setResult({
        sheetName: res.data.sheetName,
        serviceLevel: res.data.serviceLevel,
        leadTime: res.data.leadTime,
        rows: res.data.rows,
        columns: res.data.columns,
        data: res.data.data,
        processedAt: new Date().toISOString(),
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

  /* ---------- Render ---------- */

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="Executive inventory briefing with ABC-RFM segmentation, risk signals, and ROL analysis."
      />

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

            {/* Step 3: Service level + Lead time */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
                  Service level
                </label>
                <input
                  type="number"
                  min={0.01}
                  max={0.99}
                  step={0.01}
                  value={serviceLevel}
                  onChange={(e) => setServiceLevel(Number(e.target.value))}
                  className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
                  Lead time (weeks)
                </label>
                <input
                  type="number"
                  min={1}
                  max={52}
                  value={leadTime}
                  onChange={(e) => setLeadTime(Number(e.target.value))}
                  className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-ring"
                />
              </div>
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
                <div key={k} className="rounded-xl border border-border bg-background/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{k}</p>
                  <p className="mt-1 text-sm font-medium text-foreground">{v}</p>
                </div>
              ))}
            </div>
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
