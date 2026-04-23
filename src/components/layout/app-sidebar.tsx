'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser } from '@/hooks/use-user';
import { useNotifications } from '@/hooks/use-notifications';
import { getNavigation } from '@/lib/navigation';
import { ROLE_LABELS } from '@/types/database';
import { cn } from '@/lib/utils';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronsUpDown, LogOut, Wallet } from 'lucide-react';

/**
 * Finance Hub sidebar. Built on the shadcn Sidebar primitive so we get
 * keyboard toggle (Ctrl/Cmd+B), cookie-persisted collapsed state, mobile
 * Sheet behavior, and rail collapse for free.
 *
 * Brand treatment (paper + ink + gold, per _design-system/):
 *  - Base surface: --sidebar (paper-2) with paper-4 hairline border
 *  - Brand mark: ink tile with gold monospace "IO"
 *  - Active item: gold-soft fill with 2px inset gold rail on inline-start
 *  - Inactive: warm-grey foreground, hover tints to paper-3 / ink text
 */
export function AppSidebar() {
  const { user, loading } = useUser();
  const { unreadCount } = useNotifications();
  const pathname = usePathname();

  function handleSignOut() {
    // Route through the server endpoint so HTTP-only auth cookies are cleared
    window.location.href = '/auth/signout';
  }

  const initials = user?.full_name
    ? user.full_name
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() ?? '')
        .join('')
    : '—';

  return (
    <Sidebar collapsible="icon" className="border-0">
      {/* Brand */}
      <SidebarHeader className="h-16 justify-center border-b border-sidebar-border px-3">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-lg px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          aria-label="IO Finance Hub home"
        >
          <span
            aria-hidden
            className="flex size-9 items-center justify-center rounded-lg bg-primary font-mono text-[13px] font-medium text-accent ring-1 ring-inset ring-white/6"
          >
            IO
          </span>
          <span className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Impact Outsourcing
            </span>
            <span className="text-sm font-semibold text-sidebar-foreground">
              Finance Hub
            </span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2 py-3">
        {loading || !user ? (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {Array.from({ length: 8 }).map((_, i) => (
                  <SidebarMenuItem key={i}>
                    <SidebarMenuSkeleton showIcon />
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          getNavigation(user.role).map((group, gi) => (
            <SidebarGroup key={group.title}>
              <SidebarGroupLabel className="px-2 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                {group.title}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const isActive =
                      pathname === item.href ||
                      (item.href !== '/' && pathname.startsWith(item.href));
                    const Icon = item.icon;
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          isActive={isActive}
                          tooltip={item.title}
                          render={
                            <Link
                              href={item.href}
                              aria-current={isActive ? 'page' : undefined}
                            />
                          }
                          className={cn(
                            'h-9 rounded-lg px-2.5 text-[13px] font-normal',
                            'text-[var(--warm-grey-3)] transition-all duration-[var(--dur-base)] ease-[var(--ease-standard)]',
                            'hover:bg-[var(--paper-3)] hover:text-sidebar-foreground',
                            // Gold active state — soft-gold fill + 2px inset gold rail (per kit.css:26)
                            'data-active:bg-sidebar-accent',
                            'data-active:text-sidebar-accent-foreground',
                            'data-active:font-semibold',
                            'data-active:shadow-[inset_2px_0_0_0_var(--gold)]',
                            'data-active:ring-0',
                            '[&_svg]:text-muted-foreground [&_svg]:transition-colors [&_svg]:duration-[var(--dur-fast)]',
                            'hover:[&_svg]:text-sidebar-foreground',
                            'data-active:[&_svg]:text-[var(--gold-lo)]',
                          )}
                        >
                          <Icon strokeWidth={1.75} />
                          <span className="truncate">{item.title}</span>
                          {item.href === '/notifications' && unreadCount > 0 && (
                            <span
                              aria-label={`${unreadCount} unread`}
                              className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-gold px-1.5 font-mono text-[10px] font-semibold text-gold-foreground group-data-[collapsible=icon]:hidden"
                            >
                              {unreadCount > 99 ? '99+' : unreadCount}
                            </span>
                          )}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
              {gi < getNavigation(user.role).length - 1 && (
                <SidebarSeparator className="mt-2 bg-sidebar-border" />
              )}
            </SidebarGroup>
          ))
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label="Account menu"
                  className={cn(
                    'group flex w-full items-center gap-2.5 rounded-lg p-2',
                    'text-left outline-none transition-colors duration-[var(--dur-fast)]',
                    'hover:bg-[var(--paper-3)] focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                  )}
                />
              }
            >
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gold font-mono text-[11px] font-medium text-gold-foreground"
              >
                {initials}
              </span>
              <span className="flex min-w-0 flex-1 flex-col leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate text-[0.8125rem] font-semibold text-sidebar-foreground">
                  {user.full_name}
                </span>
                <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {ROLE_LABELS[user.role]}
                </span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              className="min-w-[14rem]"
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">{user.full_name}</span>
                  <span className="truncate text-xs font-normal text-muted-foreground">
                    {user.email}
                  </span>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href="/settings" />}>
                <Wallet className="size-4" aria-hidden />
                <span>Settings</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleSignOut()}
              >
                <LogOut className="size-4" aria-hidden />
                <span>Sign Out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
