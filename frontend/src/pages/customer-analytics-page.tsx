import {
  ArrowRight,
  Building2,
  DollarSign,
  ExternalLink,
  FilterX,
  Search,
  TrendingUp,
  Users,
  BarChart3,
  PieChart,
  Layers,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCallback, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart as RePieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ContentCard } from '@/components/common/content-card'
import { PageHeader } from '@/components/common/page-header'
import { PlotlySankey } from '@/components/charts/plotly-sankey'
import { useProcessedData } from '@/services/state/processed-data-context'

/* ---------- Types ---------- */

interface CustomerSummary {
  Party_Code: string
  total_revenue: number
  order_count: number
  unique_products: number
  first_order_date: string
  last_order_date: string
  recency_days: number
  avg_order_value: number
  customer_type: string
  top_category: string
  top_category_revenue: number
}

interface ConcentrationPoint {
  rank: number
  customer: string
  revenue: number
  cumul_revenue: number
  revenue_pct: number
  cumul_pct: number
  customer_type: string
}

interface TopProduct {
  party_code: string
  item_code: string
  item_name: string
  total_amount: number
  order_count: number
}

interface CategoryPref {
  category: string
  total_revenue: number
  revenue_pct: number
  customer_count: number
  order_count: number
}

interface CustomerKPIs {
  total_customers: number
  total_revenue: number
  avg_revenue_per_customer: number
  top5_pct_revenue: number
  top20_pct_revenue: number
  top5_customer_count: number
  top20_customer_count: number
  internal_revenue: number
  external_revenue: number
  internal_customer_count: number
  external_customer_count: number
}

interface CustomerRiskItem {
  category: string
  count: number
}

interface InternalExternalProduct {
  item_code: string
  item_name: string
  total_revenue: number
  external_revenue: number
  internal_revenue: number
  external_pct: number
  internal_pct: number
}

interface RevenueBand {
  band: string
  customer_count: number
  total_revenue: number
}

interface OrderBand {
  band: string
  order_count: number
}

interface SankeyData {
  labels: string[]
  source: number[]
  target: number[]
  value: number[]
  source_revenue: Record<string, number>
  target_revenue: Record<string, number>
}

interface BusinessDrivers {
  revenue_bands: RevenueBand[]
  order_bands: OrderBand[]
}

interface FilterDimensions {
  categories: string[]
  productGroups: string[]
  subGroups: string[]
}

interface CustomerAnalyticsData {
  portfolio: CustomerSummary[]
  concentration: ConcentrationPoint[]
  topProducts: TopProduct[]
  categoryPrefs: CategoryPref[]
  kpis: CustomerKPIs
  customerRiskDistribution: CustomerRiskItem[]
  sankeyData: SankeyData
  internalExternalProducts: InternalExternalProduct[]
  businessDrivers: BusinessDrivers
  filterDimensions: FilterDimensions
}

/* ---------- Helpers ---------- */

function fmtCurrency(v: number): string {
  if (v >= 1_00_00_000) return `₹${(v / 1_00_00_000).toFixed(1)}Cr`
  if (v >= 1_00_000) return `₹${(v / 1_00_000).toFixed(1)}L`
  if (v >= 1_000) return `₹${(v / 1_000).toFixed(1)}K`
  return `₹${v.toFixed(0)}`
}

function fmtNumber(v: number): string {
  return v.toLocaleString('en-IN')
}

const RISK_COLORS: Record<string, string> = {
  Low_Risk_External: '#16a34a',
  Medium_Risk_External: '#f59e0b',
  High_Risk_External: '#dc2626',
  Low_Risk_Internal: '#22c55e',
  Medium_Risk_Internal: '#e97316',
}

const RISK_LABELS: Record<string, string> = {
  Low_Risk_External: 'Low Risk (Ext)',
  Medium_Risk_External: 'Medium Risk (Ext)',
  High_Risk_External: 'High Risk (Ext)',
  Low_Risk_Internal: 'Low Risk (Int)',
  Medium_Risk_Internal: 'Medium Risk (Int)',
}

/* ---------- Reusable filter dropdown ---------- */
function FilterSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  label: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 rounded-lg border border-border bg-background px-2 text-[10px] outline-none focus:border-ring"
      aria-label={label}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

/* ---------- Component ---------- */

export function CustomerAnalyticsPage() {
  const { result } = useProcessedData()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<'All' | 'Internal' | 'External'>('All')

  // Per-chart filters
  const [selectedRisk, setSelectedRisk] = useState<string>('All')
  const [revBandType, setRevBandType] = useState<'All' | 'Internal' | 'External'>('All')
  const [ieCatFilter, setIeCatFilter] = useState<string>('All')
  const [distTypeFilter, setDistTypeFilter] = useState<'All' | 'Internal' | 'External'>('All')
  const [distRiskFilter, setDistRiskFilter] = useState<string>('All')
  const [distCatFilter, setDistCatFilter] = useState<string>('All')
  const [distGroupFilter, setDistGroupFilter] = useState<string>('All')
  const [distSubGroupFilter, setDistSubGroupFilter] = useState<string>('All')

  const TOP_N_CUSTOMERS = 20

  // Parse customer analytics from pipeline result
  const data: CustomerAnalyticsData | null = useMemo(() => {
    if (!result?.customerAnalytics) return null
    const raw = result.customerAnalytics as unknown as Record<string, unknown>
    return {
      portfolio: (raw.portfolio as unknown[]) as CustomerSummary[],
      concentration: (raw.concentration as unknown[]) as ConcentrationPoint[],
      topProducts: (raw.topProducts as unknown[]) as TopProduct[],
      categoryPrefs: (raw.categoryPrefs as unknown[]) as CategoryPref[],
      kpis: raw.kpis as unknown as CustomerKPIs,
      customerRiskDistribution: (raw.customerRiskDistribution as unknown[]) as CustomerRiskItem[],
      sankeyData: raw.sankeyData as unknown as SankeyData,
      internalExternalProducts: (raw.internalExternalProducts as unknown[]) as InternalExternalProduct[],
      businessDrivers: raw.businessDrivers as unknown as BusinessDrivers,
      filterDimensions: raw.filterDimensions as unknown as FilterDimensions,
    }
  }, [result])

  // ---- Derived data ----
  const filteredPortfolio = useMemo(() => {
    if (!data) return []
    let list = data.portfolio
    if (typeFilter !== 'All') list = list.filter((c) => c.customer_type === typeFilter)
    if (!searchQuery.trim()) return list.slice(0, TOP_N_CUSTOMERS)
    const q = searchQuery.trim().toLowerCase()
    return list.filter((c) => c.Party_Code.toLowerCase().includes(q)).slice(0, 50)
  }, [data, searchQuery, typeFilter])

  const customerDetail = useMemo(() => {
    if (!data || !selectedCustomer) return null
    const summary = data.portfolio.find((c) => c.Party_Code === selectedCustomer)
    if (!summary) return null
    const products = data.topProducts.filter((p) => p.party_code === selectedCustomer)
    return { summary, products }
  }, [data, selectedCustomer])

  // Risk-filtered customers for the Risk Assessment drill-down
  const riskFilteredCustomers = useMemo(() => {
    if (!data) return []
    if (selectedRisk === 'All') return []  // show nothing when All is selected (pie is the overview)
    return data.portfolio
      .filter((c) => _classify_customer_risk_simple(c) === selectedRisk)
      .sort((a, b) => b.total_revenue - a.total_revenue)
      .slice(0, 50)
  }, [data, selectedRisk])

  const clearSearch = useCallback(() => {
    setSearchQuery(''); setSelectedCustomer(null)
  }, [])

  const paretoData = useMemo(() => {
    if (!data) return []
    return data.concentration.slice(0, 30).map((p) => ({
      rank: `#${p.rank}`, revenue_pct: p.revenue_pct, cumul_pct: p.cumul_pct,
    }))
  }, [data])

  // Filtered revenue bands by customer type
  const filteredRevBands = useMemo(() => {
    if (!data) return []
    if (revBandType === 'All') return data.businessDrivers.revenue_bands
    const filteredPort = data.portfolio.filter((c) => c.customer_type === revBandType)
    // Re-calc bands from filtered portfolio
    const bands = [
      { label: 'Micro (<₹10K)', min: 0, max: 10_000 },
      { label: 'Small (₹10K-₹1L)', min: 10_000, max: 1_00_000 },
      { label: 'Medium (₹1L-₹10L)', min: 1_00_000, max: 10_00_000 },
      { label: 'Large (₹10L-₹1Cr)', min: 10_00_000, max: 1_00_00_000 },
      { label: 'Enterprise (>₹1Cr)', min: 1_00_00_000, max: Infinity },
    ]
    return bands.map((b) => ({
      band: b.label,
      customer_count: filteredPort.filter((c) => c.total_revenue >= b.min && c.total_revenue < b.max).length,
      total_revenue: filteredPort.filter((c) => c.total_revenue >= b.min && c.total_revenue < b.max).reduce((s, c) => s + c.total_revenue, 0),
    }))
  }, [data, revBandType])

  // Unique categories for IE product filter
  const ieCategories = useMemo(() => {
    if (!data) return []
    return ['All', ...new Set(data.internalExternalProducts.map((p) => {
      // Extract category code from item_code (first part before first dot)
      const parts = p.item_code.split('.')
      return parts.length > 0 ? parts[0] : '?'
    }))]
  }, [data])

  // Filtered IE products
  const filteredIEProducts = useMemo(() => {
    if (!data) return []
    if (ieCatFilter === 'All') return data.internalExternalProducts
    return data.internalExternalProducts.filter((p) => p.item_code.startsWith(ieCatFilter))
  }, [data, ieCatFilter])

  // Filtered revenue distribution for PDF plot — with dimension filters
  const filteredDistData = useMemo(() => {
    if (!data) return []
    let port = data.portfolio
    if (distTypeFilter !== 'All') port = port.filter((c) => c.customer_type === distTypeFilter)
    if (distRiskFilter !== 'All') {
      port = port.filter((c) => {
        const risk = _classify_customer_risk_simple(c)
        return risk === distRiskFilter
      })
    }
    if (distCatFilter !== 'All') {
      port = port.filter((c) => {
        const cats = (c as unknown as Record<string, unknown>).categories_bought as string[] | undefined
        return cats ? cats.includes(distCatFilter) : false
      })
    }
    if (distGroupFilter !== 'All') {
      port = port.filter((c) => {
        const groups = (c as unknown as Record<string, unknown>).product_groups_bought as string[] | undefined
        return groups ? groups.includes(distGroupFilter) : false
      })
    }
    if (distSubGroupFilter !== 'All') {
      port = port.filter((c) => {
        const subs = (c as unknown as Record<string, unknown>).sub_groups_bought as string[] | undefined
        return subs ? subs.includes(distSubGroupFilter) : false
      })
    }
    // Re-bin
    const bins = [0, 1000, 5000, 10000, 50000, 100000, 500000, 1000000, 5000000, 10000000, 50000000, Infinity]
    const labels = [
      '₹0-₹1K', '₹1K-₹5K', '₹5K-₹10K', '₹10K-₹50K', '₹50K-₹1L',
      '₹1L-₹5L', '₹5L-₹10L', '₹10L-₹50L', '₹50L-₹1Cr', '₹1Cr-₹5Cr', '>₹5Cr',
    ]
    const result: { bin: string; count: number; total_revenue: number }[] = []
    for (let i = 0; i < bins.length - 1; i++) {
      const cnt = port.filter((c) => c.total_revenue >= bins[i] && c.total_revenue < bins[i + 1]).length
      const rev = port.filter((c) => c.total_revenue >= bins[i] && c.total_revenue < bins[i + 1]).reduce((s, c) => s + c.total_revenue, 0)
      result.push({ bin: labels[i], count: cnt, total_revenue: rev })
    }
    return result
  }, [data, distTypeFilter, distRiskFilter, distCatFilter, distGroupFilter, distSubGroupFilter])

  /* ---------- Render: no result ---------- */
  if (!result) {
    return (
      <div>
        <PageHeader title="Customer Analytics" subtitle="Customer portfolio, concentration risk, and buying patterns." />
        <ContentCard title="Run Pipeline First" description="No processed data found.">
          <p className="text-sm text-muted-foreground">
            Go to <Link to="/overview" className="text-primary underline">Overview</Link> and run the analysis first.
          </p>
        </ContentCard>
      </div>
    )
  }

  /* ---------- Render: result but no data ---------- */
  if (!data) {
    return (
      <div>
        <PageHeader title="Customer Analytics" subtitle="Customer portfolio, concentration risk, and buying patterns." />
        <ContentCard title="Re-run Pipeline to Load Customer Analytics" description="Your current pipeline result was generated with an older version.">
          <div className="flex flex-col items-center gap-4 py-12">
            <Users size={48} className="text-muted-foreground/20" />
            <p className="max-w-lg text-center text-sm text-muted-foreground">
              Customer analytics is now computed during the pipeline run.<br />
              <strong>Go to Overview and re-run the analysis</strong> to bundle customer data.
            </p>
            <Link to="/overview" className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90">
              Go to Overview <ArrowRight size={16} />
            </Link>
          </div>
        </ContentCard>
      </div>
    )
  }

  /* ---------- Full dashboard ---------- */
  const { kpis } = data

  return (
    <div>
      <PageHeader
        title="Customer Analytics"
        subtitle={`${kpis.total_customers} customers · ${fmtCurrency(kpis.total_revenue)} total revenue · Top 5% customers drive ${kpis.top5_pct_revenue}% of revenue`}
      />

      {/* ── KPI Banner ── */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { icon: Users, color: 'bg-primary/10 text-primary', label: 'Total Customers', value: fmtNumber(kpis.total_customers) },
          { icon: DollarSign, color: 'bg-emerald-500/10 text-emerald-500', label: 'Total Revenue', value: fmtCurrency(kpis.total_revenue) },
          { icon: TrendingUp, color: 'bg-amber-500/10 text-amber-500', label: 'Avg Revenue / Customer', value: fmtCurrency(kpis.avg_revenue_per_customer) },
          { icon: Building2, color: 'bg-purple-500/10 text-purple-500', label: `Top ${kpis.top5_customer_count} (${Math.round((kpis.top5_customer_count / kpis.total_customers) * 100)}%)`, value: `${kpis.top5_pct_revenue}% of Revenue` },
        ].map((card) => (
          <div key={card.label} className="flex items-center gap-3 rounded-xl border border-border bg-background/60 px-4 py-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${card.color}`}><card.icon size={20} /></div>
            <div>
              <p className="text-xs text-muted-foreground">{card.label}</p>
              <p className="text-xl font-semibold text-foreground">{card.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── IE Cards at top ── */}
      <div className="mb-4 grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-background/60 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-[#2563eb]" />
            <p className="text-xs text-muted-foreground">External Revenue</p>
          </div>
          <p className="mt-1 text-2xl font-semibold text-foreground">{fmtCurrency(kpis.external_revenue)}</p>
          <p className="text-xs text-muted-foreground">{kpis.external_customer_count} customers</p>
        </div>
        <div className="rounded-xl border border-border bg-amber-500/5 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-[#f59e0b]" />
            <p className="text-xs text-muted-foreground">Internal Revenue</p>
          </div>
          <p className="mt-1 text-2xl font-semibold text-foreground">{fmtCurrency(kpis.internal_revenue)}</p>
          <p className="text-xs text-muted-foreground">{kpis.internal_customer_count} customers</p>
        </div>
      </div>

      {/* ── Row 1: Pareto Concentration ── */}
      <ContentCard title="Customer Concentration (Pareto)" description={`Top ${kpis.top20_customer_count} customers drive ${kpis.top20_pct_revenue}% of revenue.`} className="mb-4">
        <div className="h-72 rounded-xl border border-border bg-background/60 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={paretoData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="rank" fontSize={10} interval={4} />
              <YAxis yAxisId="left" fontSize={10} />
              <YAxis yAxisId="right" orientation="right" fontSize={10} domain={[0, 100]} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="left" dataKey="revenue_pct" name="% of Revenue" fill="#2563eb" radius={[2, 2, 0, 0]} />
              <Line yAxisId="right" dataKey="cumul_pct" name="Cumulative %" stroke="#dc2626" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ContentCard>

      {/* ── Row 2: Customer Risk Assessment — actionable ── */}
      <ContentCard title="Customer Risk Assessment" description="Risk-scored customers — click any risk level to see who needs attention." className="mb-4">
        <div className="flex items-start gap-4">
          <div className="h-64 w-1/3 shrink-0 rounded-xl border border-border bg-background/60 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <RePieChart>
                <Pie
                  data={data.customerRiskDistribution}
                  dataKey="count"
                  nameKey="category"
                  cx="50%" cy="50%"
                  outerRadius={70}
                  onClick={(entry) => {
                    const e = entry as unknown as Record<string, unknown>
                    const cat = String(e.category ?? '')
                    if (cat) setSelectedRisk(cat === selectedRisk ? 'All' : cat)
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {data.customerRiskDistribution.map((entry) => (
                    <Cell key={entry.category} fill={RISK_COLORS[entry.category] ?? '#6b7280'} opacity={selectedRisk === 'All' || selectedRisk === entry.category ? 1 : 0.3} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [Number(value ?? 0), RISK_LABELS[String(name ?? '')] ?? String(name ?? '')]}
                />
              </RePieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 min-w-0">
            {/* Risk filter tabs */}
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {[{ cat: 'All', label: 'All Customers', color: '#6b7280' },
                { cat: 'High_Risk_External', label: 'High Risk (Ext)', color: '#dc2626' },
                { cat: 'Medium_Risk_External', label: 'Medium Risk (Ext)', color: '#f59e0b' },
                { cat: 'Low_Risk_External', label: 'Low Risk (Ext)', color: '#16a34a' },
                { cat: 'Medium_Risk_Internal', label: 'Medium Risk (Int)', color: '#e97316' },
                { cat: 'Low_Risk_Internal', label: 'Low Risk (Int)', color: '#22c55e' },
              ].map((r) => (
                <button key={r.cat} type="button" onClick={() => setSelectedRisk(r.cat)}
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                    selectedRisk === r.cat
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-muted/40'
                  }`}
                >
                  <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} />
                  {r.label}
                </button>
              ))}
            </div>
            {/* Customer list for selected risk */}
            <div className="max-h-48 space-y-0.5 overflow-y-auto pr-1">
              {riskFilteredCustomers.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">No customers in this risk category.</p>
              ) : (
                riskFilteredCustomers.map((c) => (
                  <button type="button" key={c.Party_Code}
                    onClick={() => setSelectedCustomer(selectedCustomer === c.Party_Code ? null : c.Party_Code)}
                    className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted/40 ${
                      selectedCustomer === c.Party_Code ? 'border-primary bg-primary/5' : 'border-border bg-background/70'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="shrink-0 font-medium text-foreground">{c.Party_Code}</span>
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        c.customer_type === 'Internal'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      }`}>{c.customer_type === 'Internal' ? 'INT' : 'EXT'}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[10px] text-muted-foreground">{c.recency_days}d ago</span>
                      <span className="text-[10px] text-muted-foreground">{c.order_count} orders</span>
                      <span className="text-[10px] text-muted-foreground">{c.unique_products} products</span>
                      <span className="font-semibold text-foreground">{fmtCurrency(c.total_revenue)}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </ContentCard>

      {/* ── Row 3: Sankey — FULL WIDTH ── */}
      <ContentCard
        title="Customer → Product Group → SKU Flow (Sankey)"
        description={`Top 10 customers → ${(() => { const srcSet = new Set(data.sankeyData.source); const tgtSet = new Set(data.sankeyData.target); return [...srcSet].filter(i => tgtSet.has(i)).length; })()} product groups → ${(() => { const srcSet = new Set(data.sankeyData.source); const tgtSet = new Set(data.sankeyData.target); return [...tgtSet].filter(i => !srcSet.has(i)).length; })()} SKUs — ${data.sankeyData.source.length} purchase flows.`}
        className="mb-4"
      >
        <div className="h-[450px] rounded-xl border border-border bg-background/60 p-2 overflow-hidden">
          <PlotlySankey sankeyData={data.sankeyData} />
        </div>
      </ContentCard>

      {/* ── Row 4: Internal vs External by Product ── */}
      <ContentCard
        title="Internal vs External by Product"
        description="Top 25 products with revenue split — blue = External, amber = Internal."
        className="mb-4"
      >
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">Category:</span>
          <FilterSelect
            value={ieCatFilter}
            onChange={setIeCatFilter}
            options={ieCategories.map((c) => ({ value: c, label: c === 'All' ? 'All Categories' : `Code ${c}` }))}
            label="Filter by category"
          />
        </div>
        <div className="h-72 rounded-xl border border-border bg-background/60 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={filteredIEProducts.slice(0, 15)} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }} stackOffset="expand">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis type="number" fontSize={10} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} domain={[0, 1]} />
              <YAxis type="category" dataKey="item_code" fontSize={8} width={90} tick={{ fontSize: 8 }} />
              <Tooltip
                formatter={(value, name) => [`${(Number(value ?? 0) * 100).toFixed(1)}%`, String(name ?? '')]}
                labelFormatter={(label) => {
                  const p = data.internalExternalProducts.find((p_) => p_.item_code === label)
                  return p ? `${p.item_code} — ${p.item_name}` : String(label)
                }}
              />
              <Legend />
              <Bar dataKey="external_pct" name="External %" stackId="a" fill="#2563eb" radius={[0, 0, 0, 0]}>
                {filteredIEProducts.slice(0, 15).map((_, i) => (<Cell key={i} fill="#2563eb" />))}
              </Bar>
              <Bar dataKey="internal_pct" name="Internal %" stackId="a" fill="#f59e0b" radius={[0, 4, 4, 0]}>
                {filteredIEProducts.slice(0, 15).map((_, i) => (<Cell key={i} fill="#f59e0b" />))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ContentCard>

      {/* ── Row 5: Revenue Bands ── */}
      <ContentCard title="Revenue Bands" description="Customer distribution by revenue range — click filter to segment by type." className="mb-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">Customer Type:</span>
          <FilterSelect
            value={revBandType}
            onChange={(v) => setRevBandType(v as 'All' | 'Internal' | 'External')}
            options={[
              { value: 'All', label: 'All Customers' },
              { value: 'External', label: 'External Only' },
              { value: 'Internal', label: 'Internal Only' },
            ]}
            label="Filter by customer type"
          />
        </div>
        <div className="h-64 rounded-xl border border-border bg-background/60 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={filteredRevBands} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="band" fontSize={9} angle={-20} textAnchor="end" height={60} interval={0} />
              <YAxis yAxisId="left" fontSize={10} />
              <Tooltip
                formatter={(value, name) => {
                  const v = Number(value ?? 0)
                  const n = String(name ?? '')
                  return [n === 'Customers' ? fmtNumber(v) : fmtCurrency(v), n === 'Customers' ? 'Customers' : 'Revenue']
                }}
              />
              <Legend />
              <Bar yAxisId="left" dataKey="customer_count" name="Customers" fill="#2563eb" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ContentCard>

      {/* ── Row 6: Distribution PDF with dimension filters ── */}
      <ContentCard
        title="Customer Revenue Distribution (PDF)"
        description="Histogram showing customer count per revenue bucket — filters let you drill into segments."
        className="mb-4"
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-muted-foreground">Type:</span>
          <FilterSelect
            value={distTypeFilter}
            onChange={(v) => setDistTypeFilter(v as 'All' | 'Internal' | 'External')}
            options={[
              { value: 'All', label: 'All' },
              { value: 'External', label: 'External' },
              { value: 'Internal', label: 'Internal' },
            ]}
            label="Filter by type"
          />
          <span className="text-[10px] text-muted-foreground">Risk:</span>
          <FilterSelect
            value={distRiskFilter}
            onChange={setDistRiskFilter}
            options={[
              { value: 'All', label: 'All Risks' },
              { value: 'Low_Risk_External', label: 'Low Risk (Ext)' },
              { value: 'Medium_Risk_External', label: 'Medium Risk (Ext)' },
              { value: 'High_Risk_External', label: 'High Risk (Ext)' },
              { value: 'Low_Risk_Internal', label: 'Low Risk (Int)' },
              { value: 'Medium_Risk_Internal', label: 'Medium Risk (Int)' },
            ]}
            label="Filter by risk"
          />
          <span className="text-[10px] text-muted-foreground">Category:</span>
          <FilterSelect
            value={distCatFilter}
            onChange={setDistCatFilter}
            options={[
              { value: 'All', label: 'All Categories' },
              ...data.filterDimensions.categories.slice(0, 30).map((c) => ({ value: c, label: c })),
            ]}
            label="Filter by category"
          />
          <span className="text-[10px] text-muted-foreground">Group:</span>
          <FilterSelect
            value={distGroupFilter}
            onChange={setDistGroupFilter}
            options={[
              { value: 'All', label: 'All Groups' },
              ...data.filterDimensions.productGroups.slice(0, 30).map((g) => ({ value: g, label: g })),
            ]}
            label="Filter by product group"
          />
          <span className="text-[10px] text-muted-foreground">Sub Group:</span>
          <FilterSelect
            value={distSubGroupFilter}
            onChange={setDistSubGroupFilter}
            options={[
              { value: 'All', label: 'All Sub Groups' },
              ...data.filterDimensions.subGroups.slice(0, 30).map((s) => ({ value: s, label: s })),
            ]}
            label="Filter by sub group"
          />
        </div>
        <div className="h-64 rounded-xl border border-border bg-background/60 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={filteredDistData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="bin" fontSize={8} angle={-25} textAnchor="end" height={64} interval={0} tick={{ fontSize: 7 }} />
              <YAxis fontSize={10} />
              <Tooltip
                formatter={(value, name) => [fmtNumber(Number(value ?? 0)), name === 'count' ? 'Customers' : 'Revenue']}
              />
              <Bar dataKey="count" name="Customers" fill="#2563eb" radius={[2, 2, 0, 0]}>
                {filteredDistData.map((_, idx) => (
                  <Cell key={idx} fill={idx >= 7 ? '#dc2626' : idx >= 4 ? '#f59e0b' : '#2563eb'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* Color legend */}
        <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#2563eb]" /> Low-volume (₹0 – ₹5L)</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#f59e0b]" /> Mid-volume (₹5L – ₹10L)</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#dc2626]" /> High-volume (₹10L+)</span>
        </div>
      </ContentCard>

      {/* ── Row 7: Order Size Distribution ── */}
      <ContentCard title="Order Size Distribution" description="Order count by value range — identify order patterns and outliers." className="mb-4">
        <div className="h-64 rounded-xl border border-border bg-background/60 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.businessDrivers.order_bands} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="band" fontSize={9} angle={-20} textAnchor="end" height={60} interval={0} />
              <YAxis fontSize={10} />
              <Tooltip formatter={(value) => [fmtNumber(Number(value ?? 0)), 'Orders']} />
              <Bar dataKey="order_count" name="Orders" fill="#0ea5e9" radius={[2, 2, 0, 0]}>
                {data.businessDrivers.order_bands.map((_, idx) => (
                  <Cell key={idx} fill={idx === 4 ? '#dc2626' : idx === 2 ? '#f59e0b' : '#0ea5e9'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ContentCard>

      {/* ── Row 8: Customer Explorer ── */}
      <ContentCard title="Customer Explorer" description="Search and filter customers." className="mb-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="relative flex-1 min-w-[160px]">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input type="text" placeholder="Search Party_Code…" value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setSelectedCustomer(null) }}
                className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-xs outline-none focus:border-ring" />
            </label>
            <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value as 'All' | 'Internal' | 'External'); setSelectedCustomer(null) }}
              className="h-8 rounded-lg border border-border bg-background px-2 text-xs outline-none focus:border-ring">
              <option value="All">All Types</option>
              <option value="External">External</option>
              <option value="Internal">Internal</option>
            </select>
            {(searchQuery || typeFilter !== 'All') && (
              <button type="button" onClick={clearSearch} className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted/60">
                <FilterX size={14} />
              </button>
            )}
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {filteredPortfolio.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">No customers match.</p>
            ) : (
              filteredPortfolio.map((c) => (
                <button type="button" key={c.Party_Code}
                  onClick={() => setSelectedCustomer(selectedCustomer === c.Party_Code ? null : c.Party_Code)}
                  className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted/40 ${
                    selectedCustomer === c.Party_Code ? 'border-primary bg-primary/5' : 'border-border bg-background/70'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0 font-medium text-foreground">{c.Party_Code}</span>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      c.customer_type === 'Internal'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                        : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    }`}>{c.customer_type === 'Internal' ? 'INT' : 'EXT'}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[10px] text-muted-foreground">{c.unique_products} products</span>
                    <span className="font-semibold text-foreground">{fmtCurrency(c.total_revenue)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </ContentCard>

        <ContentCard
          title={customerDetail ? `Customer: ${customerDetail.summary.Party_Code}` : 'Customer Detail'}
          description={customerDetail ? `${customerDetail.summary.customer_type} · ${fmtCurrency(customerDetail.summary.total_revenue)} total` : 'Click a customer to see details.'}
        >
          {customerDetail ? (
            <div>
              <div className="grid grid-cols-3 gap-1.5 mb-2">
                {[
                  { label: 'Orders', value: fmtNumber(customerDetail.summary.order_count), icon: BarChart3 },
                  { label: 'Products', value: fmtNumber(customerDetail.summary.unique_products), icon: Layers },
                  { label: 'Avg Order', value: fmtCurrency(customerDetail.summary.avg_order_value), icon: DollarSign },
                  { label: 'Recency', value: `${customerDetail.summary.recency_days}d`, icon: TrendingUp },
                  { label: 'Top Cat.', value: customerDetail.summary.top_category, icon: PieChart },
                  { label: 'Since', value: customerDetail.summary.first_order_date.slice(0, 10), icon: Building2 },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border border-border bg-background/50 px-2 py-1.5 text-center">
                    <s.icon size={12} className="mx-auto mb-0.5 text-muted-foreground/60" />
                    <p className="text-[10px] text-muted-foreground">{s.label}</p>
                    <p className="text-xs font-semibold text-foreground truncate">{s.value}</p>
                  </div>
                ))}
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] font-medium text-muted-foreground">Top Products ({customerDetail.products.length})</p>
                </div>
                <div className="max-h-28 space-y-0.5 overflow-y-auto">
                  {customerDetail.products.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground">No product data.</p>
                  ) : (
                    customerDetail.products.map((p, i) => (
                      <div key={i} className="flex items-center justify-between rounded-md border border-border bg-background/40 px-2 py-1">
                        <div className="min-w-0 flex-1 flex items-center gap-1.5">
                          <Link to={`/inventory-explorer/${p.item_code}`} className="text-[10px] font-medium text-primary hover:underline truncate max-w-[120px]">{p.item_code}</Link>
                          <span className="text-[9px] text-muted-foreground truncate">{p.item_name}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[9px] text-muted-foreground">×{p.order_count}</span>
                          <span className="text-[10px] font-medium text-foreground">{fmtCurrency(p.total_amount)}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-32 items-center justify-center">
              <div className="text-center">
                <ExternalLink size={24} className="mx-auto mb-1 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">Search or click a customer above to see details.</p>
              </div>
            </div>
          )}
        </ContentCard>
    </div>
  )
}

/* ---- Inline classifier for frontend filtering ---- */
function _classify_customer_risk_simple(c: CustomerSummary): string {
  const recency = c.recency_days
  const orders = c.order_count
  const products = c.unique_products
  const ctype = c.customer_type

  let score = 0
  if (recency <= 30) score += 3
  else if (recency <= 90) score += 2
  else if (recency <= 180) score += 1

  if (orders >= 10) score += 3
  else if (orders >= 5) score += 2
  else if (orders >= 2) score += 1

  if (products >= 5) score += 3
  else if (products >= 3) score += 2
  else if (products >= 2) score += 1

  if (ctype === 'Internal') return score <= 3 ? 'Medium_Risk_Internal' : 'Low_Risk_Internal'
  if (score <= 2) return 'High_Risk_External'
  if (score <= 4) return 'Medium_Risk_External'
  return 'Low_Risk_External'
}
