'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { NotificationBell } from '@/components/layout/notification-bell';
import { cn } from '@/lib/utils';

/**
 * Sticky top bar that sits above the dashboard content.
 *
 * - Left: sidebar trigger + breadcrumb derived from the current path.
 * - Right: notifications.
 *
 * No data fetching. Breadcrumb labels are a simple kebab→Title mapping.
 * Keep this purely presentational so it adds no meaningful hydration cost.
 */
export function DashboardTopbar({ className }: { className?: string }) {
  const pathname = usePathname();

  const crumbs = React.useMemo(() => buildCrumbs(pathname || '/'), [pathname]);

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border/70',
        'bg-background/90 px-4 backdrop-blur-lg supports-[backdrop-filter]:bg-background/75',
        className,
      )}
    >
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="h-5" />
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-1 text-sm"
      >
        <ol className="flex min-w-0 items-center gap-1">
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <li
                key={c.href}
                className="flex min-w-0 items-center gap-1"
              >
                {i > 0 && (
                  <ChevronRight
                    className="size-3.5 shrink-0 text-muted-foreground/60"
                    aria-hidden
                  />
                )}
                {isLast ? (
                  <span
                    className="truncate font-semibold text-foreground"
                    aria-current="page"
                  >
                    {c.label}
                  </span>
                ) : (
                  <Link
                    href={c.href}
                    className="truncate text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:rounded"
                  >
                    {c.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="ml-auto flex items-center gap-1.5">
        <NotificationBell tone="dark" />
      </div>
    </header>
  );
}

// ----------------------------------------------------------------------

const LABEL_OVERRIDES: Record<string, string> = {
  '/': 'Dashboard',
  '/red-flags': 'Red Flags',
  '/budgets': 'Budgets',
  '/budgets/new': 'New Budget',
  '/expenses': 'Expenses',
  '/expenses/queue': 'Expense Queue',
  '/expenses/variance': 'Variance Dashboard',
  '/expenses/import': 'Import Expenses',
  '/revenue': 'Revenue',
  '/withdrawals': 'Withdrawals',
  '/reports': 'Reports',
  '/reports/monthly': 'Monthly P&L',
  '/reports/pnl': 'P&L Reports',
  '/reports/profitability': 'Profitability',
  '/reports/trends': 'Trends & Analytics',
  '/reports/projects': 'Project Comparison',
  '/reports/budget-accuracy': 'Budget Accuracy',
  '/reports/outstanding': 'Outstanding Receivables',
  '/reports/budget-vs-actual': 'Budget vs Actual',
  '/profit-share': 'Profit Share',
  '/misc': 'Misc Reports',
  '/agent-counts': 'Agent Counts',
  '/month-closure': 'Month Closure',
  '/projects': 'Projects',
  '/departments': 'Departments',
  '/users': 'Users',
  '/settings': 'Settings',
  '/audit': 'Audit Log',
  '/notifications': 'Notifications',
  '/financials': 'Project Financials',
};

function titleize(segment: string): string {
  return segment
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildCrumbs(pathname: string): Array<{ href: string; label: string }> {
  if (pathname === '/' || pathname === '') {
    return [{ href: '/', label: LABEL_OVERRIDES['/'] ?? 'Dashboard' }];
  }
  const parts = pathname.split('/').filter(Boolean);
  const crumbs: Array<{ href: string; label: string }> = [
    { href: '/', label: LABEL_OVERRIDES['/'] ?? 'Dashboard' },
  ];
  let href = '';
  for (const part of parts) {
    href += `/${part}`;
    crumbs.push({
      href,
      label: LABEL_OVERRIDES[href] ?? titleize(part),
    });
  }
  return crumbs;
}
