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
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { LogOut } from 'lucide-react';

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
      <div className="flex h-full w-60 flex-col border-r bg-white p-4">
        <Skeleton className="h-8 w-32 mb-4" />
        <Skeleton className="h-4 w-24 mb-6" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full mb-2" />
        ))}
      </div>
    );
  }

  if (!user) return null;

  const navGroups = getNavigation(user.role);

  return (
    <div className="flex h-full w-60 flex-col border-r bg-white">
      {/* Brand */}
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-neutral-900 text-xs font-bold text-white">
            IO
          </div>
          <span className="text-sm font-semibold">Finance Hub</span>
        </Link>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 px-3 py-4">
        {navGroups.map((group) => (
          <div key={group.title} className="mb-4">
            <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-neutral-400">
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
                      ? 'bg-neutral-100 font-medium text-neutral-900'
                      : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.title}
                </Link>
              );
            })}
          </div>
        ))}
      </ScrollArea>

      <Separator />

      {/* User info + Sign out */}
      <div className="p-3">
        <div className="mb-2 px-2">
          <p className="text-sm font-medium truncate">{user.full_name}</p>
          <p className="text-xs text-neutral-500">{ROLE_LABELS[user.role]}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-neutral-600"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
}
