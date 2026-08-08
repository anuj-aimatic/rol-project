import { Bell, ChevronDown, Search, LogOut, User } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { ThemeToggle } from '@/components/common/theme-toggle'
import { useAuth } from '@/services/state/auth-context'

export function TopNav() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()

  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/85 backdrop-blur-lg">
      <div className="flex h-16 items-center gap-4 px-5 md:px-8">
        <div className="hidden min-w-56 text-sm font-semibold text-foreground md:block">
          Inventory Intelligence Platform
        </div>

        <label className="relative w-full max-w-xl">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            placeholder="Search products, segments, or insights"
            className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
          />
        </label>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />

          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground"
            aria-label="Notifications"
          >
            <Bell size={16} />
          </button>

          {user ? (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-1.5 text-sm">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                <User size={16} />
              </div>
              <div className="hidden min-w-[8rem] flex-col text-left md:flex">
                <span className="text-sm font-medium text-foreground">{user.username}</span>
                <button
                  type="button"
                  onClick={() => {
                    logout()
                    navigate('/login')
                  }}
                  className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <LogOut size={14} />
                  Sign out
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-1.5 text-sm"
            >
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-primary/15 text-xs font-semibold text-primary">
                OP
              </span>
              <span className="hidden text-muted-foreground md:inline">Operations</span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
