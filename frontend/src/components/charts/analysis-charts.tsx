import { useMemo } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import type { InventoryRecord } from '@/services/state/processed-data-context'
import { toNumeric } from '@/services/state/processed-data-context'

/* ================================================================
   1. ABC Pareto Chart — cumulative contribution curve
   ================================================================ */

interface ParetoProps {
  data: InventoryRecord[]
}

export function ParetoChart({ data }: ParetoProps) {
  const chartData = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of data) {
      const cat = String(r.Item_Category_Code ?? '?')
      const amt = toNumeric(r.ABC_Quantum)
      map.set(cat, (map.get(cat) ?? 0) + amt)
    }

    const sorted = [...map.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)

    const total = sorted.reduce((s, i) => s + i.value, 0)
    let cumul = 0
    return sorted.map((item) => {
      cumul += item.value
      return {
        name: item.name,
        amount: item.value,
        cumulPct: total > 0 ? +(cumul / total * 100).toFixed(1) : 0,
        // Add threshold marker at every point so the 80 line spans the chart
        threshold80: 80,
      }
    })
  }, [data])

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 40 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="name" angle={-25} textAnchor="end" height={56} interval={0} fontSize={10} />
        <YAxis yAxisId="left" fontSize={10} />
        <YAxis yAxisId="right" orientation="right" unit="%" domain={[0, 100]} fontSize={10} />
        <Tooltip />
        <Legend />
        <Bar yAxisId="left" dataKey="amount" name="Order Amount" fill="#2563eb" radius={[4, 4, 0, 0]} />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="cumulPct"
          name="Cumulative %"
          stroke="#16a34a"
          strokeWidth={2}
          dot={false}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="threshold80"
          name="80% Target"
          stroke="#dc2626"
          strokeDasharray="4 4"
          strokeWidth={1.5}
          dot={false}
          legendType="line"
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

/* ================================================================
   2. RFM Scatter — Recency vs Frequency colored by RFM_Category
   ================================================================ */

const RFM_COLORS: Record<string, string> = {
  Runner: '#2563eb',
  Repeater: '#16a34a',
  Dormant: '#f59e0b',
  'Slow Mover': '#dc2626',
}

interface RfmScatterProps {
  data: InventoryRecord[]
}

export function RfmScatterChart({ data }: RfmScatterProps) {
  const scatterData = useMemo(() => {
    const maxPoints = 1000
    const step = Math.max(1, Math.floor(data.length / maxPoints))
    const sampled = data.filter((_, i) => i % step === 0)

    return sampled
      .map((r) => ({
        frequency: toNumeric(r.Frequency),
        recency: toNumeric(r.Recency),
        category: String(r.RFM_Category ?? 'Unknown'),
        itemCode: String(r.Item_Code ?? ''),
      }))
      .filter((p) => p.frequency > 0 && p.recency > 0)
  }, [data])

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis type="number" dataKey="frequency" name="Frequency" fontSize={10} />
        <YAxis type="number" dataKey="recency" name="Recency (days)" fontSize={10} reversed />
        <ZAxis range={[20, 40]} />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as {
              frequency: number
              recency: number
              category: string
              itemCode: string
            }
            return (
              <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-lg">
                <p className="font-semibold text-foreground">{p.itemCode}</p>
                <p className="text-muted-foreground">Frequency: {p.frequency}</p>
                <p className="text-muted-foreground">Recency: {p.recency} days</p>
                <p className="text-muted-foreground">Category: {p.category}</p>
              </div>
            )
          }}
        />
        <Legend />
        {Object.entries(RFM_COLORS).map(([cat, color]) => {
          const subset = scatterData.filter((p) => p.category === cat)
          if (subset.length === 0) return null
          return <Scatter key={cat} name={cat} data={subset} fill={color} fillOpacity={0.5} shape="circle" />
        })}
      </ScatterChart>
    </ResponsiveContainer>
  )
}

/* ================================================================
   3. ROL Scatter — Static vs Dynamic colored by ABC_Class
   ================================================================ */

const ABC_COLORS: Record<string, string> = {
  A: '#2563eb',
  B: '#16a34a',
  C: '#f59e0b',
}

interface RolScatterProps {
  data: InventoryRecord[]
}

export function RolScatterChart({ data }: RolScatterProps) {
  const scatterData = useMemo(() => {
    const maxPoints = 1000
    const step = Math.max(1, Math.floor(data.length / maxPoints))
    const sampled = data.filter((_, i) => i % step === 0)

    return sampled
      .map((r) => ({
        staticRol: toNumeric(r.rol_static),
        dynamicRol: toNumeric(r.rol_dynamic),
        abcClass: String(r.ABC_Class ?? '?'),
        itemCode: String(r.Item_Code ?? ''),
      }))
      .filter((p) => p.staticRol > 0 || p.dynamicRol > 0)
  }, [data])

  const maxVal = useMemo(() => {
    let m = 0
    for (const p of scatterData) {
      m = Math.max(m, p.staticRol, p.dynamicRol)
    }
    return Math.ceil(m / 100) * 100 || 1000
  }, [scatterData])

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis type="number" dataKey="staticRol" name="Static ROL" domain={[0, maxVal]} fontSize={10} />
        <YAxis type="number" dataKey="dynamicRol" name="Dynamic ROL" domain={[0, maxVal]} fontSize={10} />
        <ZAxis range={[20, 40]} />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as {
              staticRol: number
              dynamicRol: number
              abcClass: string
              itemCode: string
            }
            return (
              <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-lg">
                <p className="font-semibold text-foreground">{p.itemCode}</p>
                <p className="text-muted-foreground">Static ROL: {p.staticRol}</p>
                <p className="text-muted-foreground">Dynamic ROL: {p.dynamicRol}</p>
                <p className="text-muted-foreground">ABC Class: {p.abcClass}</p>
              </div>
            )
          }}
        />
        <Legend />
        {Object.entries(ABC_COLORS).map(([cls, color]) => {
          const subset = scatterData.filter((p) => p.abcClass === cls)
          if (subset.length === 0) return null
          return <Scatter key={cls} name={`Class ${cls}`} data={subset} fill={color} fillOpacity={0.5} shape="circle" />
        })}
      </ScatterChart>
    </ResponsiveContainer>
  )
}
