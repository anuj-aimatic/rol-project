import { Link } from 'react-router-dom'

import { ContentCard } from '@/components/common/content-card'
import { PageHeader } from '@/components/common/page-header'
import { useProcessedData } from '@/services/state/processed-data-context'

export function ReportsPage() {
  const { dataset } = useProcessedData()

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Export-ready reporting center for operational and executive distribution."
      />

      {!dataset && (
        <ContentCard title="No Report Dataset" description="Run the pipeline first from Overview.">
          <p className="text-sm text-muted-foreground">
            Reports become meaningful after processing data. Open <Link to="/overview" className="text-primary underline">Overview</Link> and run analysis.
          </p>
        </ContentCard>
      )}

      {dataset && (
        <div className="mb-4 rounded-xl border border-border bg-card/60 p-3 text-sm text-muted-foreground">
          Active report source: sheet {dataset.sheetName} | {dataset.rows.toLocaleString()} rows | processed{' '}
          {new Date(dataset.processedAt).toLocaleString()}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <ContentCard title="Excel" description="Download API generated workbook output.">
          <button
            type="button"
            className="rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!dataset}
          >
            Download Excel
          </button>
        </ContentCard>
        <ContentCard title="CSV" description="Export visible table data for ad-hoc analysis.">
          <button
            type="button"
            className="rounded-xl border border-border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!dataset}
          >
            Export CSV
          </button>
        </ContentCard>
        <ContentCard title="PDF" description="Planned enterprise report package.">
          <p className="text-sm text-muted-foreground">Coming soon</p>
        </ContentCard>
      </div>
    </div>
  )
}
