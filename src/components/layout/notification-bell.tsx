'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useNotifications, type Notification } from '@/hooks/use-notifications';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

type NotificationBellProps = {
  /** Tone used for the trigger button. "light" = white text (navy surface); "dark" = foreground on light surface. */
  tone?: 'light' | 'dark';
};

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
  return then.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function NotificationCard({
  notif,
  onRead,
}: {
  notif: Notification;
  onRead: (id: string, link: string | null) => void;
}) {
  const icon = (notif.type ? NOTIF_ICONS[notif.type] : null) || '\uD83D\uDD14';
  return (
    <button
      onClick={() => onRead(notif.id, notif.link)}
      className={cn(
        'flex w-full gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60',
        !notif.is_read
          ? 'bg-popover border-l-2 border-primary'
          : 'bg-muted/40',
      )}
    >
      <span className="mt-0.5 shrink-0 text-base">{icon}</span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-sm leading-tight',
            !notif.is_read
              ? 'font-semibold text-foreground'
              : 'text-muted-foreground',
          )}
        >
          {notif.title}
        </p>
        {notif.body && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {notif.body}
          </p>
        )}
        <p className="mt-1 text-[10px] text-muted-foreground/70">
          {timeAgo(notif.created_at)}
        </p>
      </div>
    </button>
  );
}

export function NotificationBell({ tone = 'dark' }: NotificationBellProps = {}) {
  const { notifications, unreadCount, markAsRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleRead(id: string, link: string | null) {
    markAsRead(id);
    setOpen(false);
    if (link) router.push(link);
  }

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={
          unreadCount > 0
            ? `${unreadCount} unread notifications`
            : 'Notifications'
        }
        className={cn(
          'relative',
          tone === 'light'
            ? 'text-white/70 hover:text-white hover:bg-white/10'
            : 'text-muted-foreground hover:text-foreground',
        )}
        onClick={() => setOpen(!open)}
      >
        <Bell className="size-4" aria-hidden />
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-danger-foreground ring-2 ring-background"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-10 z-50 w-[360px] rounded-xl border border-border bg-popover text-popover-foreground shadow-elev-3"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <p className="text-sm font-semibold text-foreground">Notifications</p>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="rounded-md px-1.5 py-0.5 text-xs font-medium text-info-soft-foreground hover:bg-info-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <ScrollArea className="max-h-[480px]">
            {notifications.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No notifications
              </p>
            ) : (
              notifications.slice(0, 20).map((n) => (
                <NotificationCard key={n.id} notif={n} onRead={handleRead} />
              ))
            )}
          </ScrollArea>

          {/* Footer */}
          <Separator />
          <button
            onClick={() => {
              setOpen(false);
              router.push('/notifications');
            }}
            className="block w-full rounded-b-xl py-2 text-center text-xs font-medium text-info-soft-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            View all notifications
          </button>
        </div>
      )}
    </div>
  );
}
