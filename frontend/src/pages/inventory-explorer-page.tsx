import { Link } from 'react-router-dom'
import { useState } from 'react'

import { PageHeader } from '@/components/common/page-header'
import { ContentCard } from '@/components/common/content-card'
import { useProcessedData } from '@/services/state/processed-data-context'

function formatColumnLabel(column: string, serviceLevelMode: 'fixed' | 'dynamic', fixedServiceLevel: number) {
  const fixedPct = fixedServiceLevel <= 1 ? fixedServiceLevel * 100 : fixedServiceLevel
  const fixedPctLabel = Number.isInteger(fixedPct) ? String(fixedPct) : fixedPct.toFixed(1)

  if (serviceLevelMode === 'fixed' && column === 'ROL_Client') return `ROL @ ${fixedPctLabel}%`
  if (serviceLevelMode === 'fixed' && column === 'ROL_Weekly_Client') return `ROL Weekly @ ${fixedPctLabel}%`
  if (serviceLevelMode === 'fixed' && column === 'ROL_Monthly_Client') return `ROL Monthly @ ${fixedPctLabel}%`
  if (serviceLevelMode === 'fixed' && column === 'Safety_Stock_Client') return `Safety Stock @ ${fixedPctLabel}%`
  if (serviceLevelMode === 'fixed' && column === 'Service_Level_Client') return `Safety Level @ ${fixedPctLabel}%`
  if (column === 'ROL_ABC_RF') return 'ROL (ABC-RF)'
  if (column === 'ROL_Weekly_ABC_RF') return 'ROL Weekly (ABC-RF)'
  if (column === 'ROL_Monthly_ABC_RF') return 'ROL Monthly (ABC-RF)'
  if (column === 'Safety_Stock_ABC_RF') return 'Safety Stock (ABC-RF)'
  if (column === 'Service_Level_ABC_RF') return 'Service Level (ABC-RF)'
  if (column === 'ROL_Client') return 'ROL (Client)'
  if (column === 'ROL_Weekly_Client') return 'ROL Weekly (Client)'
  if (column === 'ROL_Monthly_Client') return 'ROL Monthly (Client)'
  if (column === 'Safety_Stock_Client') return 'Safety Stock (Client)'
  if (column === 'Service_Level_Client') return 'Safety Level (Client)'
  if (column === 'D_Avg_Week') return 'D Avg (Weekly)'
  if (column === 'D_Max_Week_Client') return 'D Max (Weekly, Client)'
  if (column === 'D_Max_Week_ABC_RF') return 'D Max (Weekly, ABC-RF)'
  if (column === 'Volume_Bin_Size') return 'Volume Bin Size'
  if (column === 'Volume_Bin_Size_Derived') return 'Volume Bin Size'
  if (column === 'ROL_Weekly_Client_Derived') return `ROL Weekly @ ${fixedPctLabel}%`
  if (column === 'ROL_Monthly_Client_Derived') return `ROL Monthly @ ${fixedPctLabel}%`
  if (column === 'ROL_Weekly_ABC_RF_Derived') return 'ROL Weekly (ABC-RF)'
  if (column === 'ROL_Monthly_ABC_RF_Derived') return 'ROL Monthly (ABC-RF)'

  return column
}

function getDisplayValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return ''
    if (Number.isInteger(value)) return value.toLocaleString()
    return value.toFixed(4).replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1')
  }
  return String(value)
}

export function InventoryExplorerPage() {
  const { dataset } = useProcessedData()
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})

  if (!dataset) {
    return (
      <div>
        <PageHeader
          title="Inventory Explorer"
          subtitle="Enterprise product table with filtering, drill-down, and export workflows."
        />
        <ContentCard title="No Processed Dataset" description="Run the pipeline first from Overview.">
          <p className="text-sm text-muted-foreground">
            Explorer data appears after Step 4 succeeds. Open <Link to="/overview" className="text-primary underline">Overview</Link> and click Run Analysis.
          </p>
        </ContentCard>
      </div>
    )
  }

  const preferredColumns =
    dataset.serviceLevelMode === 'fixed'
      ? [
          'Item_Code',
          'Total_Orders',
          'Total_Qty',
          'Avg_Order_Qty',
          'Customers',
          'Avg_Weekly_Qty',
          'Std_Weekly_Qty',
          'Demand_CV',
          'Volume_Bin_Size',
          'D_Avg_Week',
          'D_Max_Week_Client',
          'Service_Level_Client',
          'Safety_Stock_Client',
          'ROL_Weekly_Client',
          'ROL_Monthly_Client',
          'ROL_Client',
          'Recommended_Inventory_Policy',
        ]
      : [
          'Item_Code',
          'ABC_Class',
          'RF_Category',
          'ABC_RF_Segment',
          'Total_Orders',
          'Total_Qty',
          'Avg_Order_Qty',
          'Volume_Bin_Size',
          'D_Avg_Week',
          'D_Max_Week_ABC_RF',
          'Service_Level_ABC_RF',
          'Safety_Stock_ABC_RF',
          'ROL_Weekly_ABC_RF',
          'ROL_Monthly_ABC_RF',
          'ROL_ABC_RF',
          'Recommended_Inventory_Policy',
        ]

  const tableColumns = preferredColumns
    .map((column) => {
      if (dataset.columns.includes(column)) return column
      if (column === 'Volume_Bin_Size') return 'Volume_Bin_Size_Derived'
      if (column === 'ROL_Weekly_Client') return 'ROL_Weekly_Client_Derived'
      if (column === 'ROL_Monthly_Client') return 'ROL_Monthly_Client_Derived'
      if (column === 'ROL_Weekly_ABC_RF') return 'ROL_Weekly_ABC_RF_Derived'
      if (column === 'ROL_Monthly_ABC_RF') return 'ROL_Monthly_ABC_RF_Derived'
      return null
    })
    .filter((column): column is string => column !== null)

  const getRowValue = (row: Record<string, string | number | boolean | null>, column: string) => {
    if (column === 'Volume_Bin_Size_Derived') {
      const totalQty = Number(row.Total_Qty ?? 0)
      if (!Number.isFinite(totalQty)) return ''
      if (totalQty <= 300) return 0
      if (totalQty <= 600) return 12
      return 24
    }

    const leadTime = Number(row.Lead_Time_Weeks ?? 4)
    const safeLeadTime = Number.isFinite(leadTime) && leadTime > 0 ? leadTime : 4

    if (column === 'ROL_Weekly_Client_Derived') {
      const rol = Number(row.ROL_Client ?? 0)
      return Number.isFinite(rol) ? rol / safeLeadTime : ''
    }
    if (column === 'ROL_Monthly_Client_Derived') {
      const rol = Number(row.ROL_Client ?? 0)
      return Number.isFinite(rol) ? (rol / safeLeadTime) * 4 : ''
    }
    if (column === 'ROL_Weekly_ABC_RF_Derived') {
      const rol = Number(row.ROL_ABC_RF ?? 0)
      return Number.isFinite(rol) ? rol / safeLeadTime : ''
    }
    if (column === 'ROL_Monthly_ABC_RF_Derived') {
      const rol = Number(row.ROL_ABC_RF ?? 0)
      return Number.isFinite(rol) ? (rol / safeLeadTime) * 4 : ''
    }

    return row[column]
  }

  const activeFilterCount = tableColumns.reduce((count, column) => {
    return count + (columnFilters[column]?.trim() ? 1 : 0)
  }, 0)

  const uniqueValuesByColumn: Record<string, string[]> = {}
  for (const column of tableColumns) {
    const values = new Set<string>()
    for (const row of dataset.data) {
      const value = getDisplayValue(getRowValue(row, column)).trim()
      if (value) values.add(value)
    }
    uniqueValuesByColumn[column] = Array.from(values).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }

  const filteredRows = dataset.data.filter((row) => {
    return tableColumns.every((column) => {
      const needle = columnFilters[column]?.trim().toLowerCase()
      if (!needle) return true
      const columnText = getDisplayValue(getRowValue(row, column)).toLowerCase()
      return columnText === needle
    })
  })

  const modeLabel =
    dataset.serviceLevelMode === 'fixed'
      ? `Client fixed mode (${dataset.fixedServiceLevel <= 1 ? (dataset.fixedServiceLevel * 100).toFixed(0) : dataset.fixedServiceLevel}%)`
      : 'ABC-RF dynamic mode'

  return (
    <div>
      <PageHeader
        title="Inventory Explorer"
        subtitle="Enterprise product table with filtering, drill-down, and export workflows."
      />

      <ContentCard title="Dataset Snapshot" description={`Sheet ${dataset.sheetName} | ${dataset.rows.toLocaleString()} rows`}>
        <div className="mb-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border px-2 py-1">Mode: {modeLabel}</span>
          <span className="rounded-full border border-border px-2 py-1">Columns: {dataset.columns.length}</span>
          <span className="rounded-full border border-border px-2 py-1">
            Showing {filteredRows.length.toLocaleString()} of {dataset.rows.toLocaleString()} rows
          </span>
          <span className="rounded-full border border-border px-2 py-1">
            Active column filters: {activeFilterCount}
          </span>
          <button
            type="button"
            onClick={() => setColumnFilters({})}
            className="rounded-full border border-border px-3 py-1 text-xs text-foreground hover:bg-muted/60"
          >
            Clear all filters
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-muted/60">
              <tr>
                {tableColumns.map((column) => (
                  <th key={column} className="border-b border-border px-3 py-2 text-left font-medium text-foreground">
                    {formatColumnLabel(column, dataset.serviceLevelMode, dataset.fixedServiceLevel)}
                  </th>
                ))}
              </tr>
              <tr>
                {tableColumns.map((column) => (
                  <th key={column + '_filter'} className="border-b border-border bg-background px-2 py-2 text-left">
                    <select
                      value={columnFilters[column] ?? ''}
                      onChange={(e) =>
                        setColumnFilters((prev) => ({
                          ...prev,
                          [column]: e.target.value,
                        }))
                      }
                      className="h-8 w-full min-w-36 rounded-lg border border-border bg-background px-2 text-xs font-normal text-foreground outline-none focus:border-ring"
                    >
                      <option value="">All</option>
                      {uniqueValuesByColumn[column].map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, idx) => (
                <tr key={idx} className="odd:bg-background even:bg-card/40">
                  {tableColumns.map((column) => (
                    <td key={column} className="border-b border-border/60 px-3 py-2 text-muted-foreground">
                      {getDisplayValue(getRowValue(row, column))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ContentCard>
    </div>
  )
}
