import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Compass,
  Layers3,
  LineChart,
  Settings,
  Table2,
  Users,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { NavLink } from 'react-router-dom'
import { useMemo, useState } from 'react'

import type { NavigationItem } from '@/types/navigation'
import { cn } from '@/lib/utils'

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)

  const items = useMemo<NavigationItem[]>(
    () => [
      { label: 'Overview', path: '/overview', icon: Compass },
      { label: 'Inventory Explorer', path: '/inventory-explorer', icon: Table2 },
      { label: 'Product Segmentation', path: '/product-segmentation', icon: Layers3 },
      { label: 'Analytics', path: '/analytics', icon: BarChart3 },
      { label: 'Customer Analytics', path: '/customer-analytics', icon: Users },
      { label: 'Reports', path: '/reports', icon: LineChart },
      { label: 'Settings', path: '/settings', icon: Settings },
    ],
    [],
  )

  return (
    <motion.aside
      animate={{ width: collapsed ? 86 : 272 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="relative hidden border-r border-border/70 bg-card/45 backdrop-blur-sm lg:block"
    >
      <div className="flex h-16 items-center border-b border-border/60 px-4">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Layers3 size={18} />
          </div>
          {!collapsed && (
            <div>
              <p className="text-sm font-semibold text-foreground">Inventory IQ</p>
              <p className="text-xs text-muted-foreground">Enterprise Suite</p>
            </div>
          )}
        </div>
      </div>

      <nav className="space-y-1 p-3">
        {items.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )
            }
          >
            <item.icon size={16} />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        className="absolute -right-3 top-20 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow"
        aria-label="Toggle sidebar"
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
    </motion.aside>
  )
}
