import { memo, useEffect, useMemo, useRef } from 'react'
import type { InventoryRecord } from '@/services/state/processed-data-context'

interface PlotlySunburstProps {
  data: InventoryRecord[]
}

function buildSunburstTree(rows: InventoryRecord[]) {
  const totalAmount = rows.reduce((s, r) => {
    const amt = typeof r.ABC_Quantum === 'number' ? r.ABC_Quantum : Number(r.ABC_Quantum ?? 0)
    return Number.isFinite(amt) ? s + amt : s
  }, 0)
  if (totalAmount === 0) return { ids: [], labels: [], parents: [], values: [], customdata: [] }

  // Single pass: build category + group aggregates using numeric indices
  const catTotals = new Map<string, number>()
  const grpTotals = new Map<string, number>()
  const subTotals = new Map<string, number>()

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const amt = typeof r.ABC_Quantum === 'number' ? r.ABC_Quantum : Number(r.ABC_Quantum ?? 0)
    if (!Number.isFinite(amt)) continue

    const cat = String(r.Item_Category_Code ?? '?')
    catTotals.set(cat, (catTotals.get(cat) ?? 0) + amt)

    const grp = String(r['Product Group Code'] ?? '?')
    const grpKey = cat + '||' + grp
    grpTotals.set(grpKey, (grpTotals.get(grpKey) ?? 0) + amt)

    const sub = String(r.Product_SubGroup_Code ?? '?')
    const subKey = grpKey + '||' + sub
    subTotals.set(subKey, (subTotals.get(subKey) ?? 0) + amt)
  }

  const ids: string[] = []
  const labels: string[] = []
  const parents: string[] = []
  const values: number[] = []
  const customdata: number[] = []
  const invTotal = totalAmount > 0 ? 100 / totalAmount : 0

  for (const [cat, v] of catTotals) {
    ids.push(cat); labels.push(cat); parents.push(''); values.push(v); customdata.push(v * invTotal)
  }
  for (const [key, v] of grpTotals) {
    const sep = key.indexOf('||')
    const cat = key.slice(0, sep)
    const grp = key.slice(sep + 2)
    ids.push(key); labels.push(grp); parents.push(cat); values.push(v); customdata.push(v * invTotal)
  }
  for (const [key, v] of subTotals) {
    const firstSep = key.indexOf('||')
    const secondSep = key.indexOf('||', firstSep + 2)
    const parentKey = key.slice(0, secondSep)
    ids.push(key); labels.push(key.slice(secondSep + 2)); parents.push(parentKey); values.push(v); customdata.push(v * invTotal)
  }

  return { ids, labels, parents, values, customdata }
}

// Deeper blue range — no pale/grey tones. Starts at visible blue-400, ends at dark blue-900.
const BLUE_COLORSCALE = [
  [0, '#60a5fa'],   // blue-400 — visible light blue (no grey)
  [0.25, '#3b82f6'], // blue-500
  [0.5, '#2563eb'],  // blue-600 — primary brand blue
  [0.75, '#1d4ed8'], // blue-700
  [1, '#1e3a8a'],    // blue-900 — deep dark
]

let plotlyInstance: typeof import('plotly.js-dist-min') | null = null

const PlotlySunburstInner = memo(function PlotlySunburstInner({ data }: PlotlySunburstProps) {
  const chartRef = useRef<HTMLDivElement>(null)

  // Memoize the tree so it's only rebuilt when data reference changes
  const tree = useMemo(() => buildSunburstTree(data), [data])

  useEffect(() => {
    if (!chartRef.current || data.length === 0 || tree.ids.length === 0) return

    let cancelled = false

    const render = async () => {
      if (!plotlyInstance) {
        plotlyInstance = await import('plotly.js-dist-min')
      }
      if (cancelled || !chartRef.current) return

      const Plot = plotlyInstance!

      const trace: Record<string, unknown> = {
        type: 'sunburst',
        ids: tree.ids,
        labels: tree.labels,
        parents: tree.parents,
        values: tree.values,
        branchvalues: 'total',
        customdata: tree.customdata,
        textinfo: 'label+percent root',
        texttemplate: '<b>%{label}</b><br>%{percentRoot:.1%}',
        hovertemplate:
          '<b>%{label}</b><br>' +
          'Amount: %{value:,.0f}<br>' +
          'Contribution: %{customdata:.2f}%<br>' +
          '<extra></extra>',
        marker: {
          colors: tree.customdata,
          colorscale: BLUE_COLORSCALE,
          cmin: 0,
          cmax: 100,
          showscale: true,
          colorbar: {
            title: { text: 'Contribution %', font: { size: 10 } },
            thickness: 12,
            tickfont: { size: 9 },
          },
        },
      }

      const layout: Record<string, unknown> = {
        margin: { t: 0, r: 0, b: 0, l: 0 },
        paper_bgcolor: 'transparent',
        font: { size: 10 },
      }

      const config: Record<string, unknown> = {
        displayModeBar: false,
        responsive: true,
      }

      await Plot.newPlot(chartRef.current!, [trace], layout, config)
    }

    render()

    return () => {
      cancelled = true
      if (chartRef.current && plotlyInstance) {
        try { plotlyInstance.purge(chartRef.current) } catch { /* ignore */ }
      }
    }
  }, [data, tree])  // eslint-disable-line react-hooks/exhaustive-deps

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No data matches current filters.
      </div>
    )
  }

  return <div ref={chartRef} className="h-full w-full" />
})

export { PlotlySunburstInner as PlotlySunburst }
