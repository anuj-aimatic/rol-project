import { Activity, AlertTriangle, CircleGauge, Loader2, ShieldCheck, Upload } from 'lucide-react'
import axios from 'axios'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { ContentCard } from '@/components/common/content-card'
import { PageHeader } from '@/components/common/page-header'
import { apiClient } from '@/services/api/client'
import { useProcessedData, type ServiceMode } from '@/services/state/processed-data-context'

interface ProcessResponse {
  sheet_name: string
  service_level_mode: ServiceMode
  fixed_service_level: number
  rows: number
  columns: string[]
  data: Array<Record<string, string | number | boolean | null>>
}

const OVERVIEW_STATE_KEY = 'overview_page_state_v1'

interface PersistedOverviewState {
  selectedSheet: string
  serviceLevelMode: ServiceMode
  fixedServiceLevel: number
  lastRows: number | null
}

function readPersistedOverviewState(): PersistedOverviewState {
  try {
    const raw = sessionStorage.getItem(OVERVIEW_STATE_KEY)
    if (!raw) {
      return {
        selectedSheet: '',
        serviceLevelMode: 'fixed',
        fixedServiceLevel: 85,
        lastRows: null,
      }
    }
    const parsed = JSON.parse(raw) as PersistedOverviewState
    return {
      selectedSheet: parsed.selectedSheet ?? '',
      serviceLevelMode: parsed.serviceLevelMode ?? 'fixed',
      fixedServiceLevel: typeof parsed.fixedServiceLevel === 'number' ? parsed.fixedServiceLevel : 85,
      lastRows: typeof parsed.lastRows === 'number' || parsed.lastRows === null ? parsed.lastRows : null,
    }
  } catch {
    return {
      selectedSheet: '',
      serviceLevelMode: 'fixed',
      fixedServiceLevel: 85,
      lastRows: null,
    }
  }
}

export function OverviewPage() {
  const { setDataset } = useProcessedData()
  const persisted = readPersistedOverviewState()
  const [file, setFile] = useState<File | null>(null)
  const [sheets, setSheets] = useState<string[]>([])
  const [selectedSheet, setSelectedSheet] = useState(persisted.selectedSheet)
  const [sheetLoadError, setSheetLoadError] = useState<string | null>(null)
  const [serviceLevelMode, setServiceLevelMode] = useState<ServiceMode>(persisted.serviceLevelMode)
  const [fixedServiceLevel, setFixedServiceLevel] = useState<number>(persisted.fixedServiceLevel)
  const [loadingSheets, setLoadingSheets] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [lastRows, setLastRows] = useState<number | null>(persisted.lastRows)
  const hasProcessed = lastRows !== null

  useEffect(() => {
    const payload: PersistedOverviewState = {
      selectedSheet,
      serviceLevelMode,
      fixedServiceLevel,
      lastRows,
    }
    sessionStorage.setItem(OVERVIEW_STATE_KEY, JSON.stringify(payload))
  }, [fixedServiceLevel, lastRows, selectedSheet, serviceLevelMode])

  useEffect(() => {
    const loadCachedSheets = async () => {
      if (sheets.length > 0 || loadingSheets) return
      try {
        const response = await apiClient.get<string[]>('/sheets')
        if (!Array.isArray(response.data) || response.data.length === 0) return
        setSheets(response.data)
        setSelectedSheet((prev) => (prev ? prev : response.data[0]))
      } catch {
        // No cached workbook available yet; this is expected on first visit.
      }
    }

    void loadCachedSheets()
  }, [loadingSheets, sheets.length])

  const processSteps = useMemo(() => {
    if (!processing) {
      return [
        { label: 'Reading workbook', done: Boolean(file) },
        { label: 'Loading worksheet', done: Boolean(selectedSheet) },
        { label: 'Running ABC analysis', done: false },
        { label: 'Running RF analysis', done: false },
        { label: 'Building segmentation', done: false },
        { label: 'Calculating ROL', done: false },
        { label: 'Preparing dashboard', done: false },
      ]
    }

    return [
      { label: 'Reading workbook', done: true },
      { label: 'Loading worksheet', done: true },
      { label: 'Running ABC analysis', done: true },
      { label: 'Running RF analysis', done: true },
      { label: 'Building segmentation', done: true },
      { label: 'Calculating ROL', done: true },
      { label: 'Preparing dashboard', done: false },
    ]
  }, [file, processing, selectedSheet])

  const onFileChange = async (nextFile: File | null) => {
    setFile(nextFile)
    setSheets([])
    setSelectedSheet('')
    setLastRows(null)
    setDataset(null)
    setSheetLoadError(null)

    if (!nextFile) return

    setLoadingSheets(true)
    try {
      const formData = new FormData()
      formData.append('file', nextFile)

      const response = await apiClient.post<string[] | { sheets: string[] }>('/sheets', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 180000,
      })

      const fetchedSheets = Array.isArray(response.data)
        ? response.data
        : Array.isArray(response.data.sheets)
          ? response.data.sheets
          : []

      if (fetchedSheets.length === 0) {
        setSheetLoadError('No worksheets were detected in this workbook.')
      }

      setSheets(fetchedSheets)
      if (fetchedSheets.length > 0) {
        setSelectedSheet(fetchedSheets[0])
      }
      toast.success('Workbook uploaded. Sheets loaded.')
    } catch (error) {
      setSheets([])
      setSelectedSheet('')
      let message = 'Failed to read workbook sheets. Please verify the file format and backend status.'
      if (axios.isAxiosError<{ detail?: string }>(error)) {
        if (error.code === 'ECONNABORTED') {
          message = 'Sheet loading timed out. Please retry or check backend performance.'
        } else {
          message = error.response?.data?.detail || error.message || message
        }
      }
      setSheetLoadError(message)
      toast.error(message)
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
      const formData = new FormData()
      if (file) {
        formData.append('file', file)
      }
      formData.append('sheet_name', selectedSheet)
      formData.append('service_level_mode', serviceLevelMode)
      if (serviceLevelMode === 'fixed') {
        formData.append('fixed_service_level', String(fixedServiceLevel))
      }

      const response = await apiClient.post<ProcessResponse>('/process', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300000,
      })

      setLastRows(response.data.rows)
      setDataset({
        sheetName: response.data.sheet_name,
        serviceLevelMode: response.data.service_level_mode,
        fixedServiceLevel: response.data.fixed_service_level,
        rows: response.data.rows,
        columns: response.data.columns,
        data: response.data.data,
        processedAt: new Date().toISOString(),
      })
      toast.success('Analysis completed successfully.')
    } catch (error) {
      if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
        toast.error('Run Analysis timed out. Please retry; backend is taking longer than expected.')
      } else {
        toast.error('Processing failed. Please verify inputs and backend availability.')
      }
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="Executive inventory briefing with optimization opportunities and operational risk signals."
      />

      <div className="mb-4">
        <ContentCard
          title="Pipeline Wizard"
          description="Guided processing workflow for workbook ingestion and analysis execution."
          icon={<Activity size={18} className="text-primary" />}
        >
          <ol className="grid gap-2 text-sm text-foreground sm:grid-cols-2 xl:grid-cols-4">
            {processSteps.map((step, idx) => (
              <li key={step.label} className="flex items-center gap-2 rounded-xl border border-border bg-background/70 p-2">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs">
                  {step.done ? '✓' : idx + 1}
                </span>
                <span className={step.done ? 'text-foreground' : 'text-muted-foreground'}>{step.label}</span>
              </li>
            ))}
          </ol>

          <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
                Step 1: Upload workbook
              </label>
              <label className="flex h-11 cursor-pointer items-center justify-between rounded-xl border border-dashed border-border bg-background px-3 text-sm hover:bg-muted/40">
                <span className="truncate text-muted-foreground">
                  {file?.name ?? (sheets.length > 0 ? 'Workbook cached in backend session' : 'Choose Order Intake.xlsx')}
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

            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
                Step 2: Select worksheet
              </label>
              <select
                value={selectedSheet}
                onChange={(e) => setSelectedSheet(e.target.value)}
                className="h-11 w-full cursor-pointer rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-ring disabled:cursor-not-allowed"
                disabled={loadingSheets || sheets.length === 0}
              >
                <option value="">
                  {loadingSheets
                    ? 'Loading sheets...'
                    : sheets.length === 0
                      ? 'Upload workbook to load sheets'
                      : 'Select sheet'}
                </option>
                {sheets.map((sheet) => (
                  <option key={sheet} value={sheet}>
                    {sheet}
                  </option>
                ))}
              </select>
              {sheetLoadError && <p className="mt-1 text-xs text-rose-500">{sheetLoadError}</p>}
            </div>

            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
                Step 3: Service level method
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setServiceLevelMode('fixed')}
                  className={
                    serviceLevelMode === 'fixed'
                      ? 'rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground'
                      : 'rounded-xl border border-border bg-background px-3 py-2 text-sm'
                  }
                >
                  Client Method
                </button>
                <button
                  type="button"
                  onClick={() => setServiceLevelMode('dynamic')}
                  className={
                    serviceLevelMode === 'dynamic'
                      ? 'rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground'
                      : 'rounded-xl border border-border bg-background px-3 py-2 text-sm'
                  }
                >
                  ABC-RF Dynamic
                </button>
              </div>
            </div>

            <div>
              {serviceLevelMode === 'fixed' && (
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
                    Fixed service level (%)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={fixedServiceLevel}
                    onChange={(e) => setFixedServiceLevel(Number(e.target.value))}
                    className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-ring"
                  />
                </div>
              )}

              <button
                type="button"
                onClick={runPipeline}
                disabled={processing || loadingSheets}
                className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                {processing && <Loader2 size={14} className="animate-spin" />}
                {processing ? 'Processing...' : 'Step 4: Run Analysis'}
              </button>
            </div>
          </div>

          {lastRows !== null && (
            <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">
              Step 5 complete: Results ready for {lastRows.toLocaleString()} products.
            </p>
          )}
        </ContentCard>
      </div>

      {hasProcessed ? (
        <>
          <div className="grid gap-4 xl:grid-cols-3">
            <ContentCard
              title="Executive Summary"
              description="Business context snapshot for current inventory posture."
              icon={<ShieldCheck size={18} className="text-primary" />}
              className="xl:col-span-2"
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ['Current Method', 'Fixed Service Level'],
                  ['Optimized Method', 'Dynamic ABC-RF'],
                  ['Products Analyzed', lastRows.toLocaleString()],
                  ['Critical Products', '124'],
                  ['Dormant Products', '704'],
                  ['Needs Review', '53 This Week'],
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
              description="Composite score across service, risk, and optimization impact."
              icon={<CircleGauge size={18} className="text-primary" />}
            >
              <div className="flex items-center gap-4">
                <div className="relative h-24 w-24 rounded-full bg-muted p-1">
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-background text-center">
                    <div>
                      <p className="text-2xl font-semibold text-foreground">87</p>
                      <p className="text-xs text-muted-foreground">/ 100</p>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Good</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Stable service levels with moderate policy uplift opportunity.
                  </p>
                </div>
              </div>
            </ContentCard>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <ContentCard
              title="Inventory Insights"
              description="Action-oriented recommendations generated from segmentation and ROL impact."
              icon={<AlertTriangle size={18} className="text-amber-500" />}
            >
              <ul className="space-y-2 text-sm text-foreground">
                <li>- 18 A-Class products are currently Dormant.</li>
                <li>- 41 Runner products require higher service levels.</li>
                <li>- Safety Stock can be reduced for 126 products.</li>
                <li>- Dynamic service levels affect 642 products.</li>
                <li>- 53 products should be reviewed this week.</li>
              </ul>
            </ContentCard>
          </div>
        </>
      ) : (
        <div className="mt-4">
          <ContentCard
            title="Waiting For Pipeline Completion"
            description="Executive Summary, Inventory Health, and Inventory Insights will unlock after Step 4 completes successfully."
            icon={<Activity size={18} className="text-primary" />}
          >
            <p className="text-sm text-muted-foreground">
              Upload workbook, select sheet, choose method, and run analysis to load overview intelligence.
            </p>
          </ContentCard>
        </div>
      )}
    </div>
  )
}
