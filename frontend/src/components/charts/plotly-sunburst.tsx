import { useEffect, useRef } from 'react'
import type { InventoryRecord } from '@/services/state/processed-data-context'

interface PlotlySunburstProps {
  data: InventoryRecord[]
}

function buildSunburstTree(rows: InventoryRecord[]) {
  const catMap = new Map<string, number>()
  const grpMap = new Map<string, number>()
  const subMap = new Map<string, number>()

  for (const r of rows) {
    const cat = String(r.Item_Category_Code ?? '?')
    const grp = String(r['Product Group Code'] ?? '?')
    const sub = String(r.Product_SubGroup_Code ?? '?')
    const amount = typeof r.ABC_Quantum === 'number' ? r.ABC_Quantum : Number(r.ABC_Quantum ?? 0)
    if (!Number.isFinite(amount)) continue

    catMap.set(cat, (catMap.get(cat) ?? 0) + amount)
    grpMap.set(`${cat}|${grp}`, (grpMap.get(`${cat}|${grp}`) ?? 0) + amount)
    subMap.set(`${cat}|${grp}|${sub}`, (subMap.get(`${cat}|${grp}|${sub}`) ?? 0) + amount)
  }

  const labels: string[] = []
  const parents: string[] = []
  const values: number[] = []
  const ids: string[] = []
  const customdata: number[] = []
  const total = [...catMap.values()].reduce((s, v) => s + v, 0)

  for (const [cat, catVal] of catMap) {
    ids.push(cat); labels.push(cat); parents.push(''); values.push(catVal)
    customdata.push(total > 0 ? (catVal / total) * 100 : 0)
  }
  for (const [key, grpVal] of grpMap) {
    const [cat, grp] = key.split('|')
    ids.push(key); labels.push(grp); parents.push(cat); values.push(grpVal)
    customdata.push(total > 0 ? (grpVal / total) * 100 : 0)
  }
  for (const [key, subVal] of subMap) {
    const parts = key.split('|')
    const grp = parts.slice(0, 2).join('|')
    ids.push(key); labels.push(parts[2]); parents.push(grp); values.push(subVal)
    customdata.push(total > 0 ? (subVal / total) * 100 : 0)
  }

  return { ids, labels, parents, values, customdata }
}

// Custom colorscale matching #2563eb (Tailwind blue-600)
const BLUE_COLORSCALE = [
  [0, '#dbeafe'],   // blue-100 — light
  [0.3, '#93c5fd'], // blue-300
  [0.6, '#3b82f6'], // blue-500
  [0.8, '#2563eb'], // blue-600 — primary
  [1, '#1d4ed8'],   // blue-700 — dark
]

let plotlyInstance: typeof import('plotly.js-dist-min') | null = null

export function PlotlySunburst({ data }: PlotlySunburstProps) {
  const chartRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chartRef.current || data.length === 0) return

    let cancelled = false

    const render = async () => {
      if (!plotlyInstance) {
        plotlyInstance = await import('plotly.js-dist-min')
      }
      if (cancelled || !chartRef.current) return

      const Plot = plotlyInstance!
      const tree = buildSunburstTree(data)

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
          colorbar: { title: 'Contribution %', thickness: 12 },
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
  }, [data])

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No data matches current filters.
      </div>
    )
  }

  return <div ref={chartRef} className="h-full w-full" />
}
