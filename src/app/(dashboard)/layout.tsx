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
  const [debugInfo, setDebugInfo] = useState('checking...');

  useEffect(() => {
    const supabase = createClient();

    async function checkAuth() {
      // Check session
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        setDebugInfo(`getSession error: ${error.message}`);
        setAuthed(false);
        return;
      }

      if (session) {
        setDebugInfo(`session found: ${session.user.email}`);
        setAuthed(true);
      } else {
        // Check localStorage directly
        const keys = Object.keys(localStorage).filter(k => k.includes('supabase'));
        setDebugInfo(`no session. localStorage supabase keys: ${keys.length > 0 ? keys.join(', ') : 'none'}`);
        setAuthed(false);
      }
    }

    checkAuth();
  }, []);

  if (authed === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f8fafc]">
        <p className="text-sm text-neutral-500">Loading... {debugInfo}</p>
      </div>
    );
  }

  if (authed === false) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f8fafc]">
        <div className="text-center space-y-3">
          <p className="text-sm text-neutral-500">Not authenticated</p>
          <p className="text-xs text-neutral-400">{debugInfo}</p>
          <a href="/login" className="text-sm text-blue-600 underline">Go to login</a>
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
