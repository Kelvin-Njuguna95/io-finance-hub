'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { Toaster } from '@/components/ui/sonner';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();

    async function checkAuth() {
      // Check session
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        setAuthed(false);
        return;
      }

      if (session) {
        setAuthed(true);
      } else {
        setAuthed(false);
      }
    }

    checkAuth();
  }, []);

  if (authed === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f8fafc]">
        <p className="text-sm text-neutral-500">Loading your workspace…</p>
      </div>
    );
  }

  if (authed === false) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f8fafc]">
        <div className="max-w-md rounded-lg border border-amber-200 bg-amber-50 p-4 text-left alert-warning">
          <p className="text-sm font-medium text-amber-900">Your session has expired.</p>
          <p className="mt-1 text-sm text-amber-800">Please sign in again to continue working in Finance Hub.</p>
          <a href="/login" className="mt-3 inline-block text-sm font-medium text-[#0f172a] underline">Go to login</a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#f8fafc]">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto content-gradient">{children}</main>
      <Toaster />
    </div>
  );
}
