import { useParams } from 'react-router-dom'

import { ContentCard } from '@/components/common/content-card'
import { PageHeader } from '@/components/common/page-header'

export function ProductDetailPage() {
  const { itemCode } = useParams()

  return (
    <div>
      <PageHeader
        title={'Product Detail: ' + (itemCode ?? 'Unknown')}
        subtitle="Decision support summary with recommendation rationale and expected demand behavior."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ContentCard title="Recommendation" description="Actionable policy narrative.">
          <ul className="space-y-2 text-sm text-foreground">
            <li>- Inventory Priority: High</li>
            <li>- Suggested Service Level: 95%</li>
            <li>- Suggested Review Frequency: Weekly</li>
            <li>- Expected Behaviour: Stable recurring demand</li>
          </ul>
        </ContentCard>

        <ContentCard title="Method Comparison" description="Client vs optimized policy outcomes.">
          <p className="text-sm text-muted-foreground">Detailed KPI comparison cards and charts will be connected next.</p>
        </ContentCard>
      </div>
    </div>
  )
}
