'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useNotifications, type Notification } from '@/hooks/use-notifications';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

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
        'w-full text-left px-3 py-2.5 flex gap-2.5 hover:bg-slate-50 transition-colors',
        !notif.is_read && 'bg-white border-l-2 border-[#0f172a]',
        notif.is_read && 'bg-slate-50/50',
      )}
    >
      <span className="text-base mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-sm leading-tight truncate',
            !notif.is_read ? 'font-semibold text-[#0f172a]' : 'text-slate-600',
          )}
        >
          {notif.title}
        </p>
        {notif.body && (
          <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{notif.body}</p>
        )}
        <p className="text-[10px] text-slate-300 mt-1">{timeAgo(notif.created_at)}</p>
      </div>
    </button>
  );
}

export function NotificationBell() {
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
        size="sm"
        className="relative h-8 w-8 p-0 text-white/60 hover:text-white hover:bg-white/10"
        onClick={() => setOpen(!open)}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-[360px] rounded-lg border border-slate-200 bg-white shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
            <p className="text-sm font-semibold text-[#0f172a]">Notifications</p>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Mark All Read
              </button>
            )}
          </div>

          {/* List */}
          <ScrollArea className="max-h-[480px]">
            {notifications.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No notifications</p>
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
            className="block w-full py-2 text-center text-xs text-blue-600 hover:bg-slate-50"
          >
            View All Notifications
          </button>
        </div>
      )}
    </div>
  );
}
