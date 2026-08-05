import type { PropsWithChildren, ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface ContentCardProps extends PropsWithChildren {
  title: ReactNode
  description?: string
  icon?: ReactNode
  className?: string
}

export function ContentCard({
  title,
  description,
  icon,
  className,
  children,
}: ContentCardProps) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-border bg-card/80 p-5 shadow-sm shadow-black/[0.03]',
        className,
      )}
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {icon}
      </header>
      {children}
    </section>
  )
}
