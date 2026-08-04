import { toast } from 'sonner'
import { Link } from 'react-router-dom'

import { ContentCard } from '@/components/common/content-card'
import { PageHeader } from '@/components/common/page-header'
import { useProcessedData } from '@/services/state/processed-data-context'
import { apiClient } from '@/services/api/client'

export function ReportsPage() {
  const { result } = useProcessedData()

  /** Build a CSV client-side from the in-memory result (fallback path). */
  const buildClientCsv = () => {
    if (!result) return null
    const headers = result.columns.join(',')
    const rows = result.data.map((row) =>
      result.columns
        .map((col) => {
          const v = row[col]
          if (v === null || v === undefined) return ''
          const s = String(v)
          // Escape commas and quotes
          return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(','),
    )
    return [headers, ...rows].join('\n')
  }

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDownloadCsv = async () => {
    if (!result) {
      toast.error('No data to export. Run the pipeline first.')
      return
    }

    const filename = `pipeline_output_${result.sheetName}.csv`

    // Prefer the backend's authoritative result so the export always matches
    // the latest run/recompute (never a stale localStorage/sessionStorage copy).
    try {
      const response = await apiClient.get('/download', {
        params: { format: 'csv' },
        responseType: 'blob',
        timeout: 120_000,
      })
      triggerDownload(response.data, filename)
      toast.success(`Exported ${result.rows.toLocaleString()} rows to CSV.`)
      return
    } catch {
      // Backend unavailable / not processed yet — fall back to client-side data.
    }

    try {
      const csv = buildClientCsv()
      if (csv === null) return
      // UTF-8 BOM so Excel renders ₹ values correctly in the fallback too
      triggerDownload(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }), filename)
      toast.success(`Exported ${result.rows.toLocaleString()} rows to CSV.`)
    } catch {
      toast.error('Failed to generate CSV.')
    }
  }

  const handleDownloadExcel = async () => {
    try {
      const response = await apiClient.get('/download', { responseType: 'blob' })
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `pipeline_output_${result?.sheetName ?? 'data'}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Excel file downloaded.')
    } catch {
      toast.error('Failed to download Excel. Ensure pipeline has been run via the API.')
    }
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Export-ready reporting center for operational and executive distribution."
      />

      {!result && (
        <ContentCard title="No Data" description="Run the pipeline first.">
          <p className="text-sm text-muted-foreground">
            Open <Link to="/overview" className="text-primary underline">Overview</Link> to process data, then return here to export.
          </p>
        </ContentCard>
      )}

      {result && (
        <div className="mb-4 rounded-xl border border-border bg-card/60 p-3 text-sm text-muted-foreground">
          Active report source: sheet <strong>{result.sheetName}</strong> ·{' '}
          {result.rows.toLocaleString()} rows · {result.columns.length} columns · processed{' '}
          {new Date(result.processedAt).toLocaleString()}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <ContentCard title="CSV" description="Export all pipeline data as CSV for ad-hoc analysis.">
          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={!result}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            Export CSV
          </button>
        </ContentCard>

        <ContentCard title="Excel" description="Download full workbook via API (same format as pipeline output).">
          <button
            type="button"
            onClick={handleDownloadExcel}
            disabled={!result}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
          >
            Download Excel
          </button>
        </ContentCard>

        <ContentCard title="PDF" description="Planned enterprise report package.">
          <p className="text-sm text-muted-foreground">Coming in a future release.</p>
        </ContentCard>
      </div>
    </div>
  )
}
