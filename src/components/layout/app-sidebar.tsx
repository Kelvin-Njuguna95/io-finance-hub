'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { useNotifications } from '@/hooks/use-notifications';
import { getNavigation } from '@/lib/navigation';
import { ROLE_LABELS } from '@/types/database';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { LogOut } from 'lucide-react';
import { NotificationBell } from '@/components/layout/notification-bell';

export function AppSidebar() {
  const { user, loading } = useUser();
  const { unreadCount } = useNotifications();
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  if (loading) {
    return (
      <div className="flex h-full w-64 flex-col sidebar-gradient p-4">
        <Skeleton className="h-8 w-32 mb-4 bg-white/20" />
        <Skeleton className="h-4 w-24 mb-6 bg-white/20" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full mb-2 bg-white/20" />
        ))}
      </div>
    );
  }

  if (!user) return null;

  const navGroups = getNavigation(user.role);

  return (
    <div className="flex h-full w-64 min-h-0 flex-col sidebar-gradient shadow-2xl shadow-[#020617]/40">
      {/* Brand */}
      <div className="flex h-14 items-center px-4 border-b border-white/10 bg-gradient-to-r from-[#0b1733] to-[#0f2248]">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#F5C518] text-[10px] font-bold text-[#0f172a] shadow-lg shadow-[#f5c518]/30">
            IO
          </div>
          <div>
            <span className="text-sm font-semibold text-white">Finance Hub</span>
            <p className="text-[10px] tracking-wider text-white/40 uppercase">Control Center</p>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 min-h-0 px-3 py-4">
        {navGroups.map((group) => (
          <div key={group.title} className="mb-4 rounded-lg border border-white/5 bg-white/[0.02] p-1.5">
            <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">
              {group.title}
            </p>
            {group.items.map((item) => {
              const isActive = pathname === item.href ||
                (item.href !== '/' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-all duration-200',
                    isActive
                      ? 'bg-gradient-to-r from-[rgba(245,197,24,0.2)] to-[rgba(245,197,24,0.05)] text-[#F5C518] font-medium shadow-sm'
                      : 'text-white/70 hover:text-white hover:bg-white/10 hover:translate-x-0.5'
                  )}
                >
                  <item.icon className={cn(
                    'h-4 w-4 shrink-0 transition-colors',
                    isActive ? 'text-[#F5C518]' : 'text-white/40'
                  )} />
                  {item.title}
                  {item.href === '/notifications' && unreadCount > 0 && (
                    <span className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </ScrollArea>

      {/* User info + Sign out */}
      <div className="p-3 border-t border-white/10 bg-gradient-to-t from-[#08122b] to-transparent">
        <div className="mb-2 px-2 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white truncate">{user.full_name}</p>
            <p className="text-xs text-white/40">{ROLE_LABELS[user.role]}</p>
          </div>
          <NotificationBell />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-white/70 hover:text-white hover:bg-white/15 border border-white/10"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
}
