'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { DashboardTopbar } from '@/components/layout/dashboard-topbar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';

/**
 * Authenticated dashboard shell.
 *
 * - Guards the dashboard behind a Supabase session check (unchanged logic).
 * - Wraps the content in the shadcn SidebarProvider so the sidebar gets
 *   cookie-persisted collapse state and Ctrl/Cmd+B toggle for free.
 * - Renders the DashboardTopbar inside the SidebarInset so the sticky
 *   topbar shifts with the sidebar.
 *
 * No API/data-flow changes — this is a purely visual refactor of the
 * previous layout.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();

    async function checkAuth() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setAuthed(Boolean(session));
    }

    checkAuth();
  }, []);

  if (authed === null) {
    return <LoadingSplash />;
  }

  if (!authed) {
    return <SignedOutSplash />;
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="bg-background">
        <DashboardTopbar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </SidebarInset>
      <Toaster />
    </SidebarProvider>
  );
}

function LoadingSplash() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div
          aria-hidden
          className="flex size-11 items-center justify-center rounded-xl bg-primary text-[13px] font-bold text-primary-foreground shadow-elev-2 ring-1 ring-white/10"
        >
          IO
        </div>
        <p className="text-sm font-medium text-muted-foreground">
          Loading Finance Hub…
        </p>
      </div>
    </div>
  );
}

function SignedOutSplash() {
  return (
    <div className="flex h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-elev-2">
        <div
          aria-hidden
          className="mx-auto flex size-11 items-center justify-center rounded-xl bg-primary text-[13px] font-bold text-primary-foreground shadow-elev-1 ring-1 ring-white/10"
        >
          IO
        </div>
        <h1 className="mt-4 text-base font-semibold text-foreground">
          Session required
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your session has expired. Sign in to continue.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Go to login
        </Link>
      </div>
    </div>
  );
}
