import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'

import { ThemeProvider } from '@/components/common/theme-provider'
import { AppRouter } from '@/router/app-router'
import { queryClient } from '@/services/query/query-client'
import { AuthProvider } from '@/services/state/auth-context'
import { ProcessedDataProvider } from '@/services/state/processed-data-context'

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ProcessedDataProvider>
            <BrowserRouter>
              <AppRouter />
              <Toaster richColors closeButton />
            </BrowserRouter>
          </ProcessedDataProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

export default App
