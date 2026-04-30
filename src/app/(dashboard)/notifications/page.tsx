'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Check, Trash2, ArrowRight } from 'lucide-react';
import type { Notification } from '@/hooks/use-notifications';

import { FilterPillBar } from '@/app/(dashboard)/misc/_components/FilterPillBar';

const NOTIF_ICONS: Record<string, string> = {
  budget_submitted: '📋',
  budget_returned: '📋',
  budget_approved: '✅',
  budget_rejected: '❌',
  misc_request_pending: '💰',
  misc_approved: '✅',
  misc_declined: '❌',
  misc_report_submitted: '💰',
  misc_draw_created: '💰',
  misc_report_overdue: '⏰',
  eod_sent: '📊',
  eod_failed: '⚠️',
  red_flag_triggered: '🚩',
  month_closed: '🔒',
  profit_share_pending: '💼',
  expense_queue_pending: '📝',
  agent_count_missing: '👥',
  payment_received: '💳',
  pm_review_complete: '✅',
};

const TYPE_CATEGORIES: Record<string, string> = {
  budget_submitted: 'budget',
  budget_returned: 'budget',
  budget_approved: 'budget',
  budget_rejected: 'budget',
  pm_review_complete: 'budget',
  misc_request_pending: 'misc',
  misc_approved: 'misc',
  misc_declined: 'misc',
  misc_report_submitted: 'misc',
  misc_draw_created: 'misc',
  misc_report_overdue: 'misc',
  payment_received: 'finance',
  profit_share_pending: 'finance',
  eod_sent: 'system',
  eod_failed: 'system',
  red_flag_triggered: 'system',
  month_closed: 'system',
  expense_queue_pending: 'finance',
  agent_count_missing: 'system',
};

type NotifTone = 'alert' | 'warn' | 'success' | 'info';

function toneFor(type: string | null | undefined): NotifTone {
  if (!type) return 'info';
  if (
    type === 'eod_failed' ||
    type === 'red_flag_triggered' ||
    type === 'budget_rejected' ||
    type === 'misc_declined'
  ) {
    return 'alert';
  }
  if (
    type === 'misc_report_overdue' ||
    type === 'misc_request_pending' ||
    type === 'expense_queue_pending' ||
    type === 'profit_share_pending' ||
    type === 'agent_count_missing' ||
    type === 'budget_submitted' ||
    type === 'budget_returned' ||
    type === 'misc_report_submitted'
  ) {
    return 'warn';
  }
  if (
    type === 'budget_approved' ||
    type === 'misc_approved' ||
    type === 'pm_review_complete' ||
    type === 'payment_received' ||
    type === 'eod_sent' ||
    type === 'month_closed'
  ) {
    return 'success';
  }
  return 'info';
}

const TONE_CLASS: Record<NotifTone, string> = {
  alert: 'bg-danger-soft text-[var(--danger)]',
  warn: 'bg-[var(--gold-soft)] text-[oklch(0.40_0.15_75)]',
  success: 'bg-success-soft text-success-soft-foreground',
  info: 'bg-[var(--paper-3)] text-foreground',
};

function timeAgo(dateStr: string): string {
  const now = new Date();
  const then = new Date(dateStr);
  const diffMs = now.getTime() - then.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat('en-KE', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' }).format(then);
}

function getDateGroup(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);

  if (d >= today) return 'Today';
  if (d >= yesterday) return 'Yesterday';
  if (d >= weekAgo) return 'This week';
  return 'Earlier';
}

type FilterKey = 'all' | 'unread' | 'budget' | 'misc' | 'finance' | 'system';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<FilterKey>('all');
  const router = useRouter();

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200);

    setNotifications((data || []).map((n) => ({
      ...n,
      body: n.body || n.message || null,
      is_read: n.is_read ?? n.read ?? false,
    })) as Notification[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function markAllRead() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('is_read', false);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }

  async function clearOldRead() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    await supabase
      .from('notifications')
      .delete()
      .eq('user_id', user.id)
      .eq('is_read', true)
      .lt('created_at', cutoff.toISOString());
    fetchAll();
  }

  async function handleClick(n: Notification) {
    if (!n.is_read) {
      const supabase = createClient();
      await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', n.id);
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)),
      );
    }
    if (n.link) router.push(n.link);
  }

  let filtered = notifications;
  if (tab === 'unread') filtered = filtered.filter((n) => !n.is_read);
  else if (tab !== 'all') filtered = filtered.filter((n) => n.type && TYPE_CATEGORIES[n.type] === tab);

  const groups: Record<string, Notification[]> = {};
  for (const n of filtered) {
    const g = getDateGroup(n.created_at);
    if (!groups[g]) groups[g] = [];
    groups[g].push(n);
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  // Counts for filter pills
  const counts = {
    all: notifications.length,
    unread: unreadCount,
    budget: notifications.filter((n) => n.type && TYPE_CATEGORIES[n.type] === 'budget').length,
    misc: notifications.filter((n) => n.type && TYPE_CATEGORIES[n.type] === 'misc').length,
    finance: notifications.filter((n) => n.type && TYPE_CATEGORIES[n.type] === 'finance').length,
    system: notifications.filter((n) => n.type && TYPE_CATEGORIES[n.type] === 'system').length,
  };

  const filterPills: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'unread', label: 'Unread', count: counts.unread },
    { key: 'budget', label: 'Budget', count: counts.budget },
    { key: 'misc', label: 'Misc', count: counts.misc },
    { key: 'finance', label: 'Finance', count: counts.finance },
    { key: 'system', label: 'System', count: counts.system },
  ];

  const headerActions = (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" className="gap-1.5" onClick={markAllRead}>
        <Check className="size-3.5" /> Mark all read
      </Button>
      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={clearOldRead}>
        <Trash2 className="size-3.5" /> Clear old read
      </Button>
    </div>
  );

  const subtitle = unreadCount > 0
    ? `${unreadCount} unread · ${notifications.length} total`
    : `All caught up · ${notifications.length} total`;

  return (
    <div className="p-6">
      <PageTitle
        primary="Your"
        accent="notifications"
        subtitle={subtitle}
        action={headerActions}
      />

      <div className="mt-6 space-y-5">
        <FilterPillBar
          pills={filterPills}
          activeKey={tab}
          onChange={(k) => setTab(k)}
        />

        {loading ? (
          <div className="rounded-[var(--radius-lg)] border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
            Please wait
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-border bg-[var(--paper-2)] px-5 py-12 text-center">
            <p className="text-sm font-medium text-foreground">You&apos;re all caught up — no new notifications.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              New activity from budgets, expenses, and finance workflows will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
            {Object.entries(groups).map(([group, items], i) => (
              <div key={group}>
                {/* Group separator */}
                <div
                  className={cn(
                    'flex items-baseline justify-between border-y border-border-subtle bg-[var(--paper-2)] px-5 py-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground',
                    i === 0 && 'border-t-0',
                  )}
                >
                  <span className="text-foreground">{group}</span>
                  <span>{items.length}</span>
                </div>
                {items.map((n) => {
                  const icon = (n.type ? NOTIF_ICONS[n.type] : null) || '🔔';
                  const tone = toneFor(n.type);
                  const isClickable = Boolean(n.link);
                  return (
                    <div
                      key={n.id}
                      role={isClickable ? 'button' : undefined}
                      tabIndex={isClickable ? 0 : undefined}
                      onClick={() => handleClick(n)}
                      onKeyDown={(e) => {
                        if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          handleClick(n);
                        }
                      }}
                      className={cn(
                        'group/notif relative grid grid-cols-[36px_1fr_120px] items-start gap-4 border-b border-border-subtle px-5 py-4 transition-colors last:border-b-0',
                        !n.is_read && 'bg-[oklch(0.99_0.02_90)]',
                        isClickable && 'cursor-pointer hover:bg-[var(--paper-2)]',
                      )}
                    >
                      {/* Icon tile */}
                      <span
                        aria-hidden
                        className={cn(
                          'inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[16px]',
                          TONE_CLASS[tone],
                        )}
                      >
                        {icon}
                      </span>

                      {/* Body */}
                      <div className="min-w-0">
                        <p
                          className={cn(
                            'text-[13.5px] leading-[1.5] text-foreground',
                            !n.is_read && 'font-medium',
                          )}
                        >
                          {n.title}
                        </p>
                        {n.body && (
                          <p className="mt-1 line-clamp-2 max-w-[620px] text-[12px] leading-[1.45] text-muted-foreground">
                            {n.body}
                          </p>
                        )}
                        {n.link && (
                          <span className="mt-1.5 inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.10em] text-foreground/70">
                            View <ArrowRight className="size-3" strokeWidth={2} />
                          </span>
                        )}
                      </div>

                      {/* Timestamp */}
                      <div
                        className={cn(
                          'text-right font-mono text-[10.5px] uppercase tracking-[0.04em] text-muted-foreground',
                        )}
                      >
                        {!n.is_read && (
                          <span
                            aria-hidden
                            className="mr-1.5 inline-block size-[7px] rounded-full bg-[var(--gold)] align-middle"
                          />
                        )}
                        {timeAgo(n.created_at)}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        <p className="pt-2 text-center text-[11px] text-muted-foreground">
          <Link href="/settings" className="text-foreground/70 underline-offset-2 hover:text-foreground hover:underline">
            Manage notification preferences
          </Link>
        </p>
      </div>
    </div>
  );
}
