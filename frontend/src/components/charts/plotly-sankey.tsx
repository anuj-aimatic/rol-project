import { useCallback, useEffect, useRef, useState } from 'react'

interface SankeyData {
  labels: string[]
  source: number[]
  target: number[]
  value: number[]
  source_revenue: Record<string, number>
  target_revenue: Record<string, number>
}

interface PlotlySankeyProps {
  sankeyData: SankeyData
}

function fmtCurrency(v: number): string {
  if (v >= 1_00_00_000) return `₹${(v / 1_00_00_000).toFixed(2)}Cr`
  if (v >= 1_00_000) return `₹${(v / 1_00_000).toFixed(2)}L`
  if (v >= 1_000) return `₹${(v / 1_000).toFixed(2)}K`
  return `₹${v.toFixed(0)}`
}

let plotlyInstance: typeof import('plotly.js-dist-min') | null = null

export function PlotlySankey({ sankeyData }: PlotlySankeyProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const [selectedNode, setSelectedNode] = useState<number | null>(null)
  const clickHandlerAttached = useRef(false)
  const handlerRef = useRef<((eventData: Record<string, unknown>) => void) | null>(null)

  // Correct total: sum of ALL link values (each flow counted once)
  const totalLinkValue = sankeyData.value.reduce((sum, v) => sum + v, 0)

  // Determine connected nodes for a given node index
  const getConnected = useCallback((nodeIdx: number): Set<number> => {
    const connected = new Set<number>([nodeIdx])
    for (let i = 0; i < sankeyData.source.length; i++) {
      if (sankeyData.source[i] === nodeIdx) connected.add(sankeyData.target[i])
      if (sankeyData.target[i] === nodeIdx) connected.add(sankeyData.source[i])
    }
    return connected
  }, [sankeyData.source, sankeyData.target])

  // Build trace data (recomputes when selectedNode changes)
  const buildTrace = useCallback(() => {
    const sourceSet = new Set(sankeyData.source)
    const targetSet = new Set(sankeyData.target)
    const connected = selectedNode !== null ? getConnected(selectedNode) : null

    // Node colors
    const nodeColors = sankeyData.labels.map((_, i) => {
      const isSrc = sourceSet.has(i) && !targetSet.has(i)
      const isTgt = targetSet.has(i) && !sourceSet.has(i)
      let base: string
      if (isSrc) base = '#2563eb'
      else if (isTgt) base = '#0d9488'
      else base = '#f59e0b'

      if (connected === null) return base
      if (i === selectedNode) return base
      if (connected.has(i)) return base
      return 'rgba(156, 163, 175, 0.06)'
    })

    // Node border: selected node gets a bright white glow
    const nodeLineColor = sankeyData.labels.map((_, i) =>
      selectedNode !== null && i === selectedNode ? '#ffffff' : 'rgba(255,255,255,0.15)'
    )
    const nodeLineWidth = sankeyData.labels.map((_, i) =>
      selectedNode !== null && i === selectedNode ? 3 : 0.5
    )

    // Link colors
    const linkColors = sankeyData.value.map((v, i) => {
      const s = sankeyData.source[i]
      const t = sankeyData.target[i]
      if (connected === null) {
        const maxVal = Math.max(...sankeyData.value, 1)
        return `rgba(37, 99, 235, ${0.12 + (v / maxVal) * 0.45})`
      }
      if (s === selectedNode || t === selectedNode) return 'rgba(37, 99, 235, 0.45)'
      if (connected.has(s) || connected.has(t)) return 'rgba(37, 99, 235, 0.2)'
      return 'rgba(156, 163, 175, 0.02)'
    })

    return {
      type: 'sankey' as const,
      orientation: 'h' as const,
      node: {
        pad: 14,
        thickness: 20,
        line: { color: nodeLineColor, width: nodeLineWidth },
        label: sankeyData.labels.map((l) =>
          l.length > 25 ? l.slice(0, 22) + '...' : l
        ),
        color: nodeColors,
        customdata: sankeyData.labels.map((l) =>
          sankeyData.source_revenue[l] ?? sankeyData.target_revenue[l] ?? 0
        ),
        hovertemplate:
          '<b>%{label}</b><br>' +
          'Revenue: ₹%{customdata:,.0f}<br>' +
          '<extra></extra>',
      },
      link: {
        source: sankeyData.source,
        target: sankeyData.target,
        value: sankeyData.value.map((v) => Math.max(v, 1)),
        color: linkColors,
        hovertemplate:
          '<b>%{source.label}</b> → <b>%{target.label}</b><br>' +
          'Amount: ₹%{value:,.0f}<br>' +
          '<extra></extra>',
      },
    }
  }, [sankeyData, selectedNode, getConnected])

  useEffect(() => {
    if (!chartRef.current || sankeyData.labels.length === 0) return

    let cancelled = false
    const div = chartRef.current

    const render = async () => {
      if (!plotlyInstance) {
        plotlyInstance = await import('plotly.js-dist-min')
      }
      if (cancelled) return

      const Plot = plotlyInstance!
      const trace = buildTrace()

      const layout: Record<string, unknown> = {
        margin: { t: 0, r: 10, b: 0, l: 10 },
        paper_bgcolor: 'transparent',
        font: { size: 10 },
        height: 420,
        // Smooth transitions between states
        transitions: [{ duration: 400, easing: 'cubic-in-out' }],
      }

      const config: Record<string, unknown> = {
        displayModeBar: false,
        responsive: true,
      }

      // Use Plotly.react for animated updates (reuses existing plot)
      await Plot.react(div, [trace], layout, config)
    }

    render()

    return () => { cancelled = true }
  }, [sankeyData, selectedNode, buildTrace])

  // Attach click handler once (Plotly persists it across .react calls)
  useEffect(() => {
    if (!chartRef.current || sankeyData.labels.length === 0) return
    if (clickHandlerAttached.current) return

    const div = chartRef.current

    const attachClick = async () => {
      if (!plotlyInstance) {
        plotlyInstance = await import('plotly.js-dist-min')
      }

      const handler = (eventData: Record<string, unknown>) => {
        const pts = (eventData as { points?: { node: number }[] }).points
        if (!pts || pts.length === 0) return
        const nodeIdx = pts[0].node
        if (nodeIdx === undefined || nodeIdx === null) return
        setSelectedNode((prev) => (prev === nodeIdx ? null : nodeIdx))
      }

      handlerRef.current = handler

      // Cast to access Plotly's custom DOM event
      ;(div as unknown as HTMLElement & { on: (ev: string, fn: (...args: unknown[]) => void) => void })
        .on('plotly_click', handler as (...args: unknown[]) => void)

      clickHandlerAttached.current = true
    }

    attachClick()

    return () => {
      // Cleanup: remove event listener
      if (handlerRef.current) {
        try {
          ;(div as unknown as HTMLElement & { removeListener: (ev: string, fn: (...args: unknown[]) => void) => void })
            .removeListener('plotly_click', handlerRef.current as (...args: unknown[]) => void)
        } catch { /* ignore */ }
      }
      clickHandlerAttached.current = false
    }
  }, [sankeyData])

  // Info for selected node
  const selectedInfo = selectedNode !== null ? (() => {
    const label = sankeyData.labels[selectedNode]
    const revenue = sankeyData.source_revenue[label] ?? sankeyData.target_revenue[label] ?? 0
    const pct = totalLinkValue > 0 ? (revenue / totalLinkValue) * 100 : 0
    const srcSet = new Set(sankeyData.source)
    const tgtSet = new Set(sankeyData.target)
    const isSrc = srcSet.has(selectedNode) && !tgtSet.has(selectedNode)
    const isTgt = tgtSet.has(selectedNode) && !srcSet.has(selectedNode)
    const level = isSrc ? 'Customer' : isTgt ? 'SKU' : 'Product Group'
    return { label, revenue, pct, level }
  })() : null

  if (sankeyData.labels.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No Sankey data available.
      </div>
    )
  }

  return (
    <div className="h-full w-full flex flex-col">
      <div ref={chartRef} className="flex-1 min-h-[380px]" />
      {/* Info panel when a node is selected */}
      {selectedInfo && (
        <div className="mt-1 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs shadow-sm transition-all">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
              {selectedInfo.label.charAt(0)}
            </div>
            <span className="font-semibold text-foreground">{selectedInfo.label}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              selectedInfo.level === 'Customer' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
              selectedInfo.level === 'SKU' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400' :
              'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
            }`}>
              {selectedInfo.level}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground">
              Amount: <span className="font-semibold text-foreground">{fmtCurrency(selectedInfo.revenue)}</span>
            </span>
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
              {selectedInfo.pct.toFixed(1)}% of total
            </span>
            <button
              type="button"
              onClick={() => setSelectedNode(null)}
              className="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/60 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      {/* Quick hint when nothing selected */}
      {!selectedInfo && (
        <div className="mt-1 text-center text-[10px] text-muted-foreground/60">
          Click any node to highlight its flow path and see revenue details
        </div>
      )}
    </div>
  )
}
