'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
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
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  if (loading) {
    return (
      <div className="flex h-full w-60 flex-col sidebar-gradient p-4">
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
    <div className="flex h-full w-60 flex-col sidebar-gradient">
      {/* Brand */}
      <div className="flex h-14 items-center px-4 border-b border-white/10">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#F5C518] text-[10px] font-bold text-[#0f172a]">
            IO
          </div>
          <span className="text-sm font-semibold text-white">Finance Hub</span>
        </Link>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 px-3 py-4">
        {navGroups.map((group) => (
          <div key={group.title} className="mb-4">
            <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-white/30">
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
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                    isActive
                      ? 'bg-[rgba(245,197,24,0.12)] text-[#F5C518] font-medium'
                      : 'text-white/60 hover:text-white hover:bg-white/5'
                  )}
                >
                  <item.icon className={cn(
                    'h-4 w-4 shrink-0',
                    isActive ? 'text-[#F5C518]' : 'text-white/40'
                  )} />
                  {item.title}
                </Link>
              );
            })}
          </div>
        ))}
      </ScrollArea>

      {/* User info + Sign out */}
      <div className="p-3 border-t border-white/10">
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
          className="w-full justify-start gap-2 text-white/60 hover:text-white hover:bg-white/10"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
}
