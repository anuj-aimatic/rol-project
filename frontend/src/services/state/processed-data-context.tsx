/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, useState, type PropsWithChildren } from 'react'

export type ServiceMode = 'fixed' | 'dynamic'

export interface InventoryRecord {
  [key: string]: string | number | boolean | null
}

export interface ProcessedDataset {
  sheetName: string
  serviceLevelMode: ServiceMode
  fixedServiceLevel: number
  rows: number
  columns: string[]
  data: InventoryRecord[]
  processedAt: string
}

interface ProcessedDataContextValue {
  dataset: ProcessedDataset | null
  setDataset: (next: ProcessedDataset | null) => void
}

const STORAGE_KEY = 'processed_dataset_v1'

const ProcessedDataContext = createContext<ProcessedDataContextValue | undefined>(undefined)

function readInitialDataset(): ProcessedDataset | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ProcessedDataset
    if (!Array.isArray(parsed.data) || !Array.isArray(parsed.columns)) return null
    return parsed
  } catch {
    return null
  }
}

export function ProcessedDataProvider({ children }: PropsWithChildren) {
  const [dataset, setDatasetState] = useState<ProcessedDataset | null>(() => readInitialDataset())

  const setDataset = (next: ProcessedDataset | null) => {
    setDatasetState(next)
    if (next === null) {
      sessionStorage.removeItem(STORAGE_KEY)
      return
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  const value = useMemo(() => ({ dataset, setDataset }), [dataset])

  return <ProcessedDataContext.Provider value={value}>{children}</ProcessedDataContext.Provider>
}

export function useProcessedData() {
  const context = useContext(ProcessedDataContext)
  if (!context) {
    throw new Error('useProcessedData must be used within ProcessedDataProvider')
  }
  return context
}
