import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'

import { ThemeProvider } from '@/components/common/theme-provider'
import { AppRouter } from '@/router/app-router'
import { queryClient } from '@/services/query/query-client'
import { ProcessedDataProvider } from '@/services/state/processed-data-context'

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ProcessedDataProvider>
          <BrowserRouter>
            <AppRouter />
            <Toaster richColors closeButton />
          </BrowserRouter>
        </ProcessedDataProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

export default App
