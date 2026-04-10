'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { Check, Trash2 } from 'lucide-react';
import type { Notification } from '@/hooks/use-notifications';

const NOTIF_ICONS: Record<string, string> = {
  budget_submitted: '\uD83D\uDCCB',
  budget_returned: '\uD83D\uDCCB',
  budget_approved: '\u2705',
  budget_rejected: '\u274C',
  misc_request_pending: '\uD83D\uDCB0',
  misc_approved: '\u2705',
  misc_declined: '\u274C',
  misc_report_submitted: '\uD83D\uDCB0',
  misc_draw_created: '\uD83D\uDCB0',
  misc_report_overdue: '\u23F0',
  eod_sent: '\uD83D\uDCCA',
  eod_failed: '\u26A0\uFE0F',
  red_flag_triggered: '\uD83D\uDEA9',
  month_closed: '\uD83D\uDD12',
  profit_share_pending: '\uD83D\uDCBC',
  expense_queue_pending: '\uD83D\uDCDD',
  agent_count_missing: '\uD83D\uDC65',
  payment_received: '\uD83D\uDCB3',
  pm_review_complete: '\u2705',
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
  return then.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getDateGroup(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);

  if (d >= today) return 'Today';
  if (d >= yesterday) return 'Yesterday';
  if (d >= weekAgo) return 'This Week';
  return 'Earlier';
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
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

  // Filter by tab
  let filtered = notifications;
  if (tab === 'unread') filtered = filtered.filter((n) => !n.is_read);
  else if (tab !== 'all') filtered = filtered.filter((n) => n.type && TYPE_CATEGORIES[n.type] === tab);

  // Group by date
  const groups: Record<string, Notification[]> = {};
  for (const n of filtered) {
    const g = getDateGroup(n.created_at);
    if (!groups[g]) groups[g] = [];
    groups[g].push(n);
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div>
      <PageHeader title="Notifications" description={unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={markAllRead}>
          <Check className="h-3.5 w-3.5" /> Mark All Read
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground" onClick={clearOldRead}>
          <Trash2 className="h-3.5 w-3.5" /> Clear Old Read
        </Button>
      </PageHeader>

      <div className="p-6 space-y-4">
        {/* Filter tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="unread">Unread {unreadCount > 0 && <Badge variant="secondary" className="ml-1 h-5 bg-red-100 text-red-600">{unreadCount}</Badge>}</TabsTrigger>
            <TabsTrigger value="budget">Budget</TabsTrigger>
            <TabsTrigger value="misc">Misc</TabsTrigger>
            <TabsTrigger value="finance">Finance</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
          </TabsList>
        </Tabs>

        {loading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Please wait</p>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/50 px-4 py-10 text-center">
            <p className="text-sm font-medium text-foreground/90">You&apos;re all caught up — no new notifications at this time.</p>
            <p className="mt-1 text-xs text-muted-foreground">New activity from budgets, expenses, and finance workflows will appear here automatically.</p>
          </div>
        ) : (
          Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">{group}</p>
              <div className="space-y-1">
                {items.map((n) => {
                  const icon = (n.type ? NOTIF_ICONS[n.type] : null) || '\uD83D\uDD14';
                  return (
                    <button
                      key={n.id}
                      onClick={() => handleClick(n)}
                      className={cn(
                        'w-full text-left flex gap-3 rounded-lg px-4 py-3 transition-colors',
                        !n.is_read
                          ? 'bg-card border border-border border-l-4 border-l-primary shadow-sm'
                          : 'bg-muted/50 hover:bg-muted',
                      )}
                    >
                      <span className="text-lg mt-0.5 shrink-0">{icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className={cn(
                          'text-sm leading-tight',
                          !n.is_read ? 'font-semibold text-foreground' : 'text-foreground/80',
                        )}>
                          {n.title}
                        </p>
                        {n.body && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-muted-foreground/60">{timeAgo(n.created_at)}</span>
                          {n.link && (
                            <span className="text-[10px] text-blue-500">View &rarr;</span>
                          )}
                        </div>
                      </div>
                      {!n.is_read && (
                        <div className="shrink-0 mt-1">
                          <div className="h-2 w-2 rounded-full bg-blue-500" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}

        <p className="text-center text-xs text-muted-foreground/60 pt-4">
          <Link href="/settings" className="text-blue-500 hover:underline">Manage notification preferences</Link>
        </p>
      </div>
    </div>
  );
}
