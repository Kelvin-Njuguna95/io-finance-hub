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
    <div className="flex h-screen items-center justify-center bg-sidebar">
      <div className="flex flex-col items-center gap-4">
        <div
          aria-hidden
          className="flex size-12 items-center justify-center rounded-xl bg-white/15 text-[14px] font-semibold text-white ring-1 ring-white/10"
        >
          IO
        </div>
        <div className="text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/60">
            Impact Outsourcing
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            Finance Hub
          </p>
        </div>
        <div className="mt-2 flex gap-1">
          <span className="size-1.5 rounded-full bg-electric animate-pulse" />
          <span className="size-1.5 rounded-full bg-electric/60 animate-pulse [animation-delay:150ms]" />
          <span className="size-1.5 rounded-full bg-electric/30 animate-pulse [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

function SignedOutSplash() {
  return (
    <div className="flex h-screen items-center justify-center bg-sidebar px-6">
      <div className="w-full max-w-sm rounded-xl border border-white/10 bg-white/[0.04] p-6 text-center shadow-elev-2 backdrop-blur">
        <div
          aria-hidden
          className="mx-auto flex size-12 items-center justify-center rounded-xl bg-white/15 text-[14px] font-semibold text-white ring-1 ring-white/10"
        >
          IO
        </div>
        <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/60">
          Impact Outsourcing
        </p>
        <h1 className="mt-2 text-base font-semibold text-white">
          Session required
        </h1>
        <p className="mt-1 text-sm text-white/65">
          Your session has expired. Sign in to continue.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-flex h-9 items-center justify-center rounded-[8px] bg-white px-4 text-sm font-medium text-[#1E3A5F] transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
        >
          Go to login
        </Link>
      </div>
    </div>
  );
}
