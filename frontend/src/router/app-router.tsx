import { Navigate, Route, Routes } from 'react-router-dom'
import { type ReactNode } from 'react'

import { AppShellLayout } from '@/layouts/app-shell-layout'
import { AnalyticsPage } from '@/pages/analytics-page'
import { CustomerAnalyticsPage } from '@/pages/customer-analytics-page'
import { InventoryExplorerPage } from '@/pages/inventory-explorer-page'
import { LoginPage } from '@/pages/login-page'
import { OverviewPage } from '@/pages/overview-page'
import { ProductDetailPage } from '@/pages/product-detail-page'
import { ProductSegmentationPage } from '@/pages/product-segmentation-page'
import { ReportsPage } from '@/pages/reports-page'
import { SettingsPage } from '@/pages/settings-page'
import { useAuth } from '@/services/state/auth-context'

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth()

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return children
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShellLayout />
          </RequireAuth>
        }
      >
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
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
