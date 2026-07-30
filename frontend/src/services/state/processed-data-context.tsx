/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, useState, type PropsWithChildren } from 'react'

export interface InventoryRecord {
  [key: string]: string | number | boolean | null
}

export interface PipelineResult {
  sheetName: string
  serviceLevel: number
  leadTime: number
  rows: number
  columns: string[]
  data: InventoryRecord[]
  processedAt: string
}

interface ProcessedDataContextValue {
  result: PipelineResult | null
  setResult: (next: PipelineResult | null) => void
}

const STORAGE_KEY = 'pipeline_result_v2'

const ProcessedDataContext = createContext<ProcessedDataContextValue | undefined>(undefined)

function readInitialResult(): PipelineResult | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
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
      sessionStorage.removeItem(STORAGE_KEY)
      return
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
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
