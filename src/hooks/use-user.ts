'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@/types/database';

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    async function getUser() {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      setUser(data);
      setLoading(false);
    }

    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      getUser();
    });

    return () => subscription.unsubscribe();
  }, []);

  return { user, loading };
}
