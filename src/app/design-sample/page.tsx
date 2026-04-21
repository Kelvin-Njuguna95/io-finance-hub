'use client';

/**
 * /design-sample — Finance Hub Design System Sample
 *
 * Public, authentication-free showcase of every UI primitive introduced
 * in the overhaul: HeroCard, StatCard tones, SectionCard, PageHeader,
 * EmptyState, Table, Tabs, Dialog, and static previews of the sidebar
 * and topbar. All data on this page is hard-coded. No Supabase, no API,
 * no data fetching.
 *
 * Middleware allowlist for this path lives in
 * `src/lib/supabase/middleware.ts`.
 */

import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowRight,
  BarChart3,
  Bell,
  ChevronRight,
  ChevronsUpDown,
  ClipboardList,
  Coins,
  DollarSign,
  Eye,
  FileText,
  Flag,
  Inbox,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Monitor,
  PanelLeft,
  PieChart,
  Plus,
  Receipt,
  ScrollText,
  ShieldAlert,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';

import { cn } from '@/lib/utils';

import { HeroCard } from '@/components/layout/hero-card';
import { StatCard } from '@/components/layout/stat-card';
import { SectionCard } from '@/components/layout/section-card';
import { PageHeader } from '@/components/layout/page-header';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

// ---------------------------------------------------------------- mock data

type MockFlag = {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
};

const MOCK_FLAGS: MockFlag[] = [
  {
    id: 'f1',
    severity: 'critical',
    title: 'Project Atlas over budget by 18%',
    description: 'Mar spend KES 14.2M vs. budget KES 12.0M',
  },
  {
    id: 'f2',
    severity: 'high',
    title: 'Withdrawal outpacing invoice cycle',
    description: 'Week 2 pull exceeds lagged revenue average',
  },
  {
    id: 'f3',
    severity: 'medium',
    title: '3 expenses missing budget category',
    description: 'Queued for Team Lead review',
  },
  {
    id: 'f4',
    severity: 'low',
    title: '1 invoice not yet acknowledged',
    description: 'Client: Ocean Holdings · sent 4d ago',
  },
];

const SEVERITY: Record<
  MockFlag['severity'],
  { badge: string; icon: typeof Flag; label: string }
> = {
  low: {
    badge: 'bg-info-soft text-info-soft-foreground',
    icon: Flag,
    label: 'Low',
  },
  medium: {
    badge: 'bg-warning-soft text-warning-soft-foreground',
    icon: AlertTriangle,
    label: 'Medium',
  },
  high: {
    badge: 'bg-warning-soft text-warning-soft-foreground',
    icon: AlertTriangle,
    label: 'High',
  },
  critical: {
    badge: 'bg-danger-soft text-danger-soft-foreground',
    icon: ShieldAlert,
    label: 'Critical',
  },
};

const MOCK_BUDGETS = [
  { id: 'b1', name: 'v4 · Atlas Monthly', amount: 'KES 12,400,000', status: 'submitted' as const },
  { id: 'b2', name: 'v2 · Delta Overhead', amount: 'KES 3,800,000', status: 'under_review' as const },
  { id: 'b3', name: 'v3 · Payroll Pool', amount: 'KES 9,200,000', status: 'submitted' as const },
];

type ExpenseStatus = 'confirmed' | 'modified' | 'pending' | 'voided';

const MOCK_EXPENSES: Array<{
  id: string;
  project: string;
  category: string;
  description: string;
  budgeted: string;
  actual: string;
  status: ExpenseStatus;
}> = [
  {
    id: 'e1',
    project: 'Atlas',
    category: 'Tools',
    description: 'Figma Enterprise — 12 seats',
    budgeted: '45,000',
    actual: '43,200',
    status: 'confirmed',
  },
  {
    id: 'e2',
    project: 'Delta',
    category: 'Utilities',
    description: 'Office internet — March',
    budgeted: '12,000',
    actual: '12,800',
    status: 'modified',
  },
  {
    id: 'e3',
    project: 'Shared',
    category: 'Rent',
    description: 'HQ floor — March',
    budgeted: '320,000',
    actual: '320,000',
    status: 'confirmed',
  },
  {
    id: 'e4',
    project: 'Atlas',
    category: 'Payroll',
    description: 'Contractor draw — week 2',
    budgeted: '82,000',
    actual: '—',
    status: 'pending',
  },
  {
    id: 'e5',
    project: 'Shared',
    category: 'Misc',
    description: 'Courier · signed POs',
    budgeted: '3,500',
    actual: '2,900',
    status: 'confirmed',
  },
  {
    id: 'e6',
    project: 'Delta',
    category: 'Tools',
    description: 'Duplicate SaaS seat',
    budgeted: '4,800',
    actual: '—',
    status: 'voided',
  },
];

const STATUS_BADGE: Record<ExpenseStatus, string> = {
  confirmed: 'bg-success-soft text-success-soft-foreground',
  modified: 'bg-violet-soft text-violet-soft-foreground',
  pending: 'bg-warning-soft text-warning-soft-foreground',
  voided: 'bg-danger-soft text-danger-soft-foreground',
};
const STATUS_LABEL: Record<ExpenseStatus, string> = {
  confirmed: 'Confirmed',
  modified: 'Modified',
  pending: 'Pending',
  voided: 'Voided',
};

const MOCK_NAV = [
  { group: 'Overview', items: [
    { label: 'Dashboard', icon: LayoutDashboard, active: true },
    { label: 'Red Flags', icon: Flag, active: false },
  ]},
  { group: 'Financial Operations', items: [
    { label: 'Budgets', icon: FileText, active: false },
    { label: 'Expenses', icon: Receipt, active: false },
    { label: 'Expense Queue', icon: ListChecks, active: false },
    { label: 'Revenue', icon: DollarSign, active: false },
    { label: 'Withdrawals', icon: ArrowDownToLine, active: false },
  ]},
  { group: 'Reports', items: [
    { label: 'Monthly P&L', icon: FileText, active: false },
    { label: 'Trends', icon: BarChart3, active: false },
    { label: 'Profitability', icon: PieChart, active: false },
  ]},
];

// ---------------------------------------------------------------- page

export default function DesignSamplePage() {
  const [dialogOpen, setDialogOpen] = React.useState(false);

  return (
    <div className="min-h-screen bg-background">
      <SampleTopbar onOpenDialog={() => setDialogOpen(true)} />

      <main className="mx-auto max-w-[1280px] space-y-8 px-4 py-6 md:px-6 md:py-8">
        <PageHeader
          title="Design System Sample"
          eyebrow="IO Finance Hub · Preview"
          description="Every primitive rendered with mock data. Toggle the theme, open the dialog, and resize the viewport to inspect dark mode, focus states, and responsive layout."
          icon={LayoutDashboard}
          tone="brand"
          meta={
            <>
              <Badge className="bg-success-soft text-success-soft-foreground">
                No auth required
              </Badge>
              <Badge className="bg-info-soft text-info-soft-foreground">
                Mock data only
              </Badge>
              <Badge className="bg-muted text-muted-foreground">
                Tokens · dark-mode safe
              </Badge>
            </>
          }
        >
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => setDialogOpen(true)}
          >
            <Eye className="size-4" aria-hidden />
            Open example dialog
          </Button>
        </PageHeader>

        {/* HeroCard */}
        <HeroCard
          stats={[
            {
              label: 'Bank Balance',
              value: '$284,120',
              subtitle: 'Available after withdrawals',
              icon: Landmark,
              tone: 'accent',
            },
            {
              label: 'Revenue (Lagged)',
              value: 'KES 24.6M',
              subtitle: 'From Feb 2026 invoice',
              icon: DollarSign,
              tone: 'teal',
            },
            {
              label: 'Operating Profit',
              value: 'KES 7.2M',
              subtitle: 'Mar 2026',
              icon: Wallet,
              tone: 'success',
            },
            {
              label: 'Total Agents',
              value: '412',
              subtitle: 'Mar 2026',
              icon: Users,
              tone: 'info',
            },
            {
              label: 'Red Flags',
              value: '4',
              subtitle: 'Requires attention',
              icon: Flag,
              tone: 'danger',
            },
          ]}
          actions={
            <div className="flex items-center gap-2 text-foreground">
              <Button
                size="sm"
                variant="outline"
                className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              >
                Export PDF
              </Button>
              <Button
                size="sm"
                className="gap-1 bg-accent text-accent-foreground hover:bg-accent/90"
              >
                <Plus className="size-4" aria-hidden />
                New entry
              </Button>
            </div>
          }
        />

        {/* StatCard tones */}
        <SectionCard
          title="StatCard tones"
          description="Every semantic tone available on the KPI primitive"
          icon={BarChart3}
          tone="info"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Revenue"
              value="$1.24M"
              subtitle="Last 30 days"
              icon={DollarSign}
              tone="brand"
              trend={{ value: '4.2%', direction: 'up' }}
            />
            <StatCard
              title="Profit"
              value="$412K"
              subtitle="Margin 34%"
              icon={TrendingUp}
              tone="success"
              trend={{ value: '2.1%', direction: 'up' }}
            />
            <StatCard
              title="Pending Budgets"
              value="7"
              subtitle="Waiting CFO review"
              icon={FileText}
              tone="violet"
            />
            <StatCard
              title="Expense Queue"
              value="23"
              subtitle="Unconfirmed"
              icon={Receipt}
              tone="warning"
              trend={{ value: '5', direction: 'down', label: 'vs last week' }}
            />
            <StatCard
              title="Red Flags"
              value="4"
              subtitle="Critical + high"
              icon={ShieldAlert}
              tone="danger"
            />
            <StatCard
              title="Receivables"
              value="$48.2K"
              subtitle="0–30 days aging"
              icon={Coins}
              tone="teal"
            />
            <StatCard
              title="Scheduled Payouts"
              value="$12.8K"
              subtitle="Next 7 days"
              icon={ArrowDownToLine}
              tone="info"
            />
            <StatCard
              title="Loading state"
              value="—"
              icon={Users}
              tone="brand"
              loading
            />
          </div>
        </SectionCard>

        {/* Two SectionCards side-by-side */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SectionCard
            title="Red Flags"
            description="Mock severity-ranked risk signals"
            icon={Flag}
            tone="danger"
            action={
              <Button variant="ghost" size="sm" className="gap-1">
                View all
                <ArrowRight className="size-3.5" aria-hidden />
              </Button>
            }
          >
            <ul className="space-y-2">
              {MOCK_FLAGS.map((flag) => {
                const sev = SEVERITY[flag.severity];
                const Icon = sev.icon;
                return (
                  <li
                    key={flag.id}
                    className="flex items-start gap-3 rounded-lg border border-border/70 bg-muted/30 p-3"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg',
                        sev.badge,
                      )}
                    >
                      <Icon className="size-3.5" strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {flag.title}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {flag.description}
                      </p>
                    </div>
                    <Badge className={cn('shrink-0', sev.badge)}>
                      {sev.label}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          </SectionCard>

          <SectionCard
            title="Budget Queue"
            description="Versions awaiting CFO review"
            icon={ClipboardList}
            tone="violet"
            action={
              <Button variant="ghost" size="sm" className="gap-1">
                View all
                <ArrowRight className="size-3.5" aria-hidden />
              </Button>
            }
          >
            <ul className="space-y-2">
              {MOCK_BUDGETS.map((bv) => (
                <li
                  key={bv.id}
                  className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/30 p-3"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {bv.name}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {bv.amount}
                    </p>
                  </div>
                  <Badge
                    className={
                      bv.status === 'submitted'
                        ? 'bg-info-soft text-info-soft-foreground'
                        : 'bg-warning-soft text-warning-soft-foreground'
                    }
                  >
                    {bv.status.replace('_', ' ')}
                  </Badge>
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>

        {/* EmptyState */}
        <SectionCard
          title="Recent Withdrawals"
          description="EmptyState primitive"
          icon={ArrowDownToLine}
          tone="info"
        >
          <EmptyState
            icon={Inbox}
            tone="neutral"
            title="No withdrawals recorded"
            description="Withdrawals will appear here once the accountant logs them."
            action={
              <Button size="sm" className="gap-1">
                <Plus className="size-4" aria-hidden />
                Log withdrawal
              </Button>
            }
          />
        </SectionCard>

        {/* Dense table */}
        <SectionCard
          title="Expense Ledger"
          description="Dense table with zebra rows, navy header, brand hover tint"
          icon={Receipt}
          tone="warning"
          action={
            <Button variant="ghost" size="sm" className="gap-1">
              View queue
              <ArrowRight className="size-3.5" aria-hidden />
            </Button>
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Budgeted (KES)</TableHead>
                <TableHead className="text-right">Actual (KES)</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {MOCK_EXPENSES.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.project}</TableCell>
                  <TableCell>{row.category}</TableCell>
                  <TableCell className="max-w-[260px] truncate">
                    {row.description}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.budgeted}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.actual}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge className={STATUS_BADGE[row.status]}>
                      {STATUS_LABEL[row.status]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>

        {/* Tabs */}
        <SectionCard
          title="Tabs primitive"
          description="Navy-pill default variant; line variant available via variant='line'"
          icon={PieChart}
          tone="teal"
        >
          <Tabs defaultValue="revenue" className="gap-4">
            <TabsList>
              <TabsTrigger value="revenue">Revenue</TabsTrigger>
              <TabsTrigger value="expenses">Expenses</TabsTrigger>
              <TabsTrigger value="pnl">P&amp;L</TabsTrigger>
            </TabsList>
            <TabsContent value="revenue">
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                Revenue tab content — Recharts consumers live in the reports
                pages migration (deferred).
              </div>
            </TabsContent>
            <TabsContent value="expenses">
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                Expenses tab content — dense ledger and category breakdowns.
              </div>
            </TabsContent>
            <TabsContent value="pnl">
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                P&amp;L tab content — monthly statement with waterfall.
              </div>
            </TabsContent>
          </Tabs>
        </SectionCard>

        {/* Static sidebar + topbar preview */}
        <SectionCard
          title="Navigation primitives"
          description="Static preview of sidebar active/inactive states and topbar composition"
          icon={PanelLeft}
          tone="brand"
        >
          <div className="grid gap-6 md:grid-cols-[260px_1fr]">
            <MockSidebar />
            <MockTopbarPreview />
          </div>
        </SectionCard>

        {/* Usage notes */}
        <SectionCard
          title="How to use this page"
          description="Quick usage notes for non-technical reviewers"
          icon={ScrollText}
          tone="neutral"
        >
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground marker:text-foreground/70">
            <li>
              <span className="text-foreground font-medium">Toggle theme:</span>{' '}
              use the sun/moon button in the top-right corner to switch between
              light, dark, and system.
            </li>
            <li>
              <span className="text-foreground font-medium">Open the dialog:</span>{' '}
              click <span className="font-mono">Open example dialog</span> above.
              Try <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-semibold">Tab</kbd>{' '}
              and <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-semibold">Esc</kbd>{' '}
              to verify focus trap + return focus.
            </li>
            <li>
              <span className="text-foreground font-medium">Resize the window:</span>{' '}
              the hero stat grid collapses from 5→4→2→1 columns and the topbar
              compresses for mobile (try narrower than 420px).
            </li>
            <li>
              <span className="text-foreground font-medium">Keyboard tour:</span>{' '}
              press <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-semibold">Tab</kbd>{' '}
              repeatedly. Every interactive element has a visible focus ring.
            </li>
            <li>
              <span className="text-foreground font-medium">No data is persisted.</span>{' '}
              Everything on this page is hard-coded. Safe to share with
              stakeholders, no credentials required.
            </li>
          </ol>
        </SectionCard>
      </main>

      {/* Example dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => !open && setDialogOpen(false)}
      >
        <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader className="border-b border-border pb-3">
            <DialogTitle>Example Modal</DialogTitle>
            <DialogDescription>
              This is the shadcn Dialog primitive. It ships with focus trap,
              Escape to close, and focus return to the trigger.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2 text-sm text-foreground/85">
            <p className="text-muted-foreground">
              Try these keyboard interactions:
            </p>
            <ul className="ml-5 list-disc space-y-1 text-muted-foreground">
              <li>
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-semibold">
                  Tab
                </kbd>{' '}
                /{' '}
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-semibold">
                  Shift+Tab
                </kbd>{' '}
                — focus is trapped inside the dialog
              </li>
              <li>
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-semibold">
                  Esc
                </kbd>{' '}
                — closes the dialog
              </li>
              <li>When closed, focus returns to the trigger button</li>
            </ul>
            <p className="text-muted-foreground">
              The dialog surface uses tokens: <code>bg-popover</code>,{' '}
              <code>text-popover-foreground</code>, <code>shadow-elev-3</code>.
            </p>
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setDialogOpen(false)}>Confirm</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------- topbar

function SampleTopbar({ onOpenDialog }: { onOpenDialog: () => void }) {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/70',
        'bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:px-6',
      )}
    >
      <span
        aria-hidden
        className="flex size-9 items-center justify-center rounded-xl bg-primary text-[13px] font-bold text-primary-foreground shadow-elev-1 ring-1 ring-white/10"
      >
        IO
      </span>
      <div className="flex flex-col leading-tight">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Finance Hub
        </span>
        <span className="text-sm font-semibold text-foreground">
          Design System Sample
        </span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Mock data · no auth required
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open example dialog"
          onClick={onOpenDialog}
          className="text-muted-foreground hover:text-foreground"
        >
          <Eye className="size-4" aria-hidden />
        </Button>
        <Link
          href="/login"
          className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          Back to login
        </Link>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- mock sidebar

function MockSidebar() {
  return (
    <div className="overflow-hidden rounded-xl bg-sidebar text-sidebar-foreground shadow-elev-2 ring-1 ring-white/10">
      {/* Brand */}
      <div className="flex h-16 items-center gap-2.5 border-b border-white/10 px-3">
        <span
          aria-hidden
          className="flex size-9 items-center justify-center rounded-lg bg-sidebar-primary text-[11px] font-bold text-sidebar-primary-foreground shadow-elev-1 ring-1 ring-white/10"
        >
          IO
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">
            Impact Outsourcing
          </span>
          <span className="text-sm font-semibold text-white">
            Finance Hub
          </span>
        </div>
      </div>
      {/* Nav */}
      <div className="space-y-3 px-2 py-3">
        {MOCK_NAV.map((group) => (
          <div key={group.group}>
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
              {group.group}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.label}>
                    <span
                      className={cn(
                        'flex h-9 items-center gap-2 rounded-lg px-2.5 text-[0.8125rem] font-medium',
                        item.active
                          ? 'bg-[color-mix(in_oklab,var(--sidebar-primary)_18%,transparent)] text-sidebar-primary-foreground font-semibold ring-1 ring-inset ring-sidebar-primary/30'
                          : 'text-white/75 hover:bg-white/5 hover:text-white',
                      )}
                    >
                      <Icon
                        strokeWidth={1.75}
                        className={cn(
                          'size-4 shrink-0',
                          item.active ? 'text-sidebar-primary' : 'text-white/60',
                        )}
                      />
                      <span className="truncate">{item.label}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {/* Footer (account row) */}
      <div className="border-t border-white/10 p-2">
        <div className="flex w-full items-center gap-2.5 rounded-lg p-2">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[12px] font-semibold text-white ring-1 ring-white/10"
          >
            KN
          </span>
          <div className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-[0.8125rem] font-semibold text-white">
              Kelvin Njuguna
            </span>
            <span className="truncate text-[11px] text-white/50">
              CFO
            </span>
          </div>
          <ChevronsUpDown
            aria-hidden
            className="size-4 shrink-0 text-white/40"
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- mock topbar

function MockTopbarPreview() {
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-elev-1">
        <div className="flex h-14 items-center gap-3 border-b border-border/70 bg-background px-4">
          <Button variant="ghost" size="icon-sm" aria-label="Toggle sidebar">
            <PanelLeft className="size-4" aria-hidden />
          </Button>
          <div className="h-5 w-px bg-border" />
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm">
            <span className="text-muted-foreground">Dashboard</span>
            <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden />
            <span className="text-muted-foreground">Reports</span>
            <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden />
            <span className="font-semibold text-foreground" aria-current="page">
              Monthly P&amp;L
            </span>
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" size="icon-sm" aria-label="Theme">
              <Monitor className="size-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Notifications"
              className="relative"
            >
              <Bell className="size-4" aria-hidden />
              <span
                aria-hidden
                className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-danger-foreground ring-2 ring-background"
              >
                3
              </span>
            </Button>
          </div>
        </div>
        <div className="flex items-start justify-between gap-4 px-4 py-5">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20"
            >
              <TrendingUp className="size-5" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Finance · Reports
              </p>
              <h3 className="text-xl font-semibold tracking-tight text-foreground">
                Monthly P&amp;L
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Revenue from Feb 2026, costs from Mar 2026
              </p>
            </div>
          </div>
          <Button size="sm" className="gap-1">
            <Plus className="size-4" aria-hidden />
            New entry
          </Button>
        </div>
      </div>
      <ul className="space-y-1.5 text-xs text-muted-foreground">
        <li className="flex items-start gap-2">
          <span aria-hidden className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
          Sidebar toggle, breadcrumb, theme toggle, and notification bell live in the real topbar.
        </li>
        <li className="flex items-start gap-2">
          <span aria-hidden className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
          PageHeader stacks beneath the topbar inside the content area.
        </li>
        <li className="flex items-start gap-2">
          <span aria-hidden className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
          In the authenticated shell, <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold">Ctrl/Cmd+B</kbd> toggles the sidebar rail.
        </li>
      </ul>
    </div>
  );
}

