/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, useState, type PropsWithChildren } from 'react'

export interface InventoryRecord {
  [key: string]: string | number | boolean | null
}

export interface CustomerAnalyticsData {
  portfolio: Record<string, unknown>[]
  concentration: Record<string, unknown>[]
  topProducts: Record<string, unknown>[]
  categoryPrefs: Record<string, unknown>[]
  kpis: Record<string, number | string>
  customerRiskDistribution: Record<string, unknown>[]
  sankeyData: Record<string, unknown>
  internalExternalProducts: Record<string, unknown>[]
  businessDrivers: Record<string, unknown>
}

export interface PipelineResult {
  sheetName: string
  serviceLevel: number
  leadTime: number
  rows: number
  columns: string[]
  data: InventoryRecord[]
  processedAt: string
  customerAnalytics?: CustomerAnalyticsData
  /** "global" (single level for all SKUs) or "risk" (per Risk_Category level). */
  serviceLevelMode?: 'global' | 'risk'
  /** Risk_Category → service level (fraction) when serviceLevelMode === 'risk'. */
  riskServiceLevels?: Record<string, number> | null
}

interface ProcessedDataContextValue {
  result: PipelineResult | null
  setResult: (next: PipelineResult | null) => void
}

const STORAGE_KEY = 'pipeline_result_v3'
const FALLBACK_KEY = 'pipeline_result_v2' // legacy sessionStorage key (pre-v3)

const ProcessedDataContext = createContext<ProcessedDataContextValue | undefined>(undefined)

/** Read from localStorage first (survives back-nav / tab close / restart), then legacy sessionStorage. */
function readInitialResult(): PipelineResult | null {
  const raw = (() => {
    try {
      const local = localStorage.getItem(STORAGE_KEY)
      if (local) return local
    } catch {
      /* storage unavailable — fall through to sessionStorage */
    }
    try {
      return sessionStorage.getItem(FALLBACK_KEY)
    } catch {
      return null
    }
  })()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as PipelineResult
    if (!Array.isArray(parsed.data) || !Array.isArray(parsed.columns)) return null
    return parsed
  } catch {
    return null
  }
}

export function ProcessedDataProvider({ children }: PropsWithChildren) {
  const [result, setResultState] = useState<PipelineResult | null>(() => readInitialResult())

  const setResult = (next: PipelineResult | null) => {
    setResultState(next)
    if (next === null) {
      try {
        localStorage.removeItem(STORAGE_KEY)
        sessionStorage.removeItem(FALLBACK_KEY)
      } catch {
        /* storage unavailable */
      }
      return
    }
    const raw = JSON.stringify(next)
    try {
      // localStorage is per-origin and persists across tab close / browser restart
      localStorage.setItem(STORAGE_KEY, raw)
    } catch {
      // Quota exceeded (very large datasets) → fall back to sessionStorage.
      // Drop any stale localStorage copy so the fresher fallback wins on reload.
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        /* storage unavailable */
      }
      try {
        sessionStorage.setItem(FALLBACK_KEY, raw)
      } catch {
        /* storage unavailable */
      }
    }
  }

  const value = useMemo(() => ({ result, setResult }), [result])

  return <ProcessedDataContext.Provider value={value}>{children}</ProcessedDataContext.Provider>
}

export function useProcessedData() {
  const context = useContext(ProcessedDataContext)
  if (!context) {
    throw new Error('useProcessedData must be used within ProcessedDataProvider')
  }
  return context
}

/* ---- helper utilities ---- */

export function toNumeric(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

export function countBy<T extends string>(
  data: InventoryRecord[],
  field: string,
): Record<T, number> {
  const map: Record<string, number> = {}
  for (const row of data) {
    const val = String(row[field] ?? 'Unknown')
    map[val] = (map[val] ?? 0) + 1
  }
  return map as Record<T, number>
}

export function average(data: InventoryRecord[], field: string): number {
  if (data.length === 0) return 0
  let sum = 0
  for (const row of data) sum += toNumeric(row[field])
  return sum / data.length
}
