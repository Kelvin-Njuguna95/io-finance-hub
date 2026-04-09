'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@/types/database';
import { toast } from 'sonner';
import { getUserErrorMessage } from '@/lib/errors';

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    async function getUser() {
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      if (authError) {
        toast.error(getUserErrorMessage(authError, 'Failed to load user session.'));
        setLoading(false);
        return;
      }
      if (!authUser) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (error) {
        toast.error(getUserErrorMessage(error, 'Failed to load your profile.'));
      }
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
