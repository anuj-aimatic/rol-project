import { Navigate, Route, Routes } from 'react-router-dom'

import { AppShellLayout } from '@/layouts/app-shell-layout'
import { AnalyticsPage } from '@/pages/analytics-page'
import { CustomerAnalyticsPage } from '@/pages/customer-analytics-page'
import { InventoryExplorerPage } from '@/pages/inventory-explorer-page'
import { OverviewPage } from '@/pages/overview-page'
import { ProductDetailPage } from '@/pages/product-detail-page'
import { ProductSegmentationPage } from '@/pages/product-segmentation-page'
import { ReportsPage } from '@/pages/reports-page'
import { SettingsPage } from '@/pages/settings-page'

export function AppRouter() {
  return (
    <Routes>
      <Route element={<AppShellLayout />}>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/inventory-explorer" element={<InventoryExplorerPage />} />
        <Route path="/inventory-explorer/:itemCode" element={<ProductDetailPage />} />
        <Route path="/product-segmentation" element={<ProductSegmentationPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/customer-analytics" element={<CustomerAnalyticsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  )
}
