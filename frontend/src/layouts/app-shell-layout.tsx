import { AnimatePresence, motion } from 'framer-motion'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

import { Sidebar } from '@/components/layout/sidebar'
import { TopNav } from '@/components/layout/top-nav'

export function AppShellLayout() {
  const location = useLocation()
  const mobileNavItems = [
    { label: 'Overview', path: '/overview' },
    { label: 'Explorer', path: '/inventory-explorer' },
    { label: 'Segmentation', path: '/product-segmentation' },
    { label: 'Optimization', path: '/inventory-optimization' },
    { label: 'Analytics', path: '/analytics' },
    { label: 'Policies', path: '/inventory-policies' },
    { label: 'Reports', path: '/reports' },
    { label: 'Settings', path: '/settings' },
  ]

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopNav />

        <nav className="border-b border-border/60 bg-background/80 px-5 py-2 md:px-8 lg:hidden">
          <div className="flex gap-2 overflow-x-auto">
            {mobileNavItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  [
                    'shrink-0 rounded-lg border px-3 py-1.5 text-sm transition-colors',
                    isActive
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground',
                  ].join(' ')
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>

        <main className="flex-1 overflow-x-hidden px-5 pb-7 pt-6 md:px-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}
