'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { getUserErrorMessage } from '@/lib/errors';

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  message?: string | null;
  type: string | null;
  entity_type: string | null;
  entity_id: string | null;
  project_id: string | null;
  link: string | null;
  is_read: boolean;
  read?: boolean;
  read_at: string | null;
  created_at: string;
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) {
      toast.error(getUserErrorMessage(authError, 'Failed to load notifications session.'));
      setLoading(false);
      return;
    }
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      toast.error(getUserErrorMessage(error, 'Failed to load notifications.'));
      setLoading(false);
      return;
    }

    const items = (data || []).map((n: /* // */ any) => ({
      ...n,
      body: n.body || n.message || null,
      is_read: n.is_read ?? n.read ?? false,
    })) as Notification[];
    setNotifications(items);
    setUnreadCount(items.filter((n) => !n.is_read).length);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchNotifications();

    // Subscribe to realtime notifications
    const supabase = createClient();
    async function setupRealtime() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const channel = supabase
        .channel('notifications-' + user.id)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const newNotif = payload.new as Notification;
            setNotifications((prev) => [newNotif, ...prev].slice(0, 50));
            setUnreadCount((prev) => prev + 1);
          },
        )
        .subscribe();

      return channel;
    }

    const channelPromise = setupRealtime();

    return () => {
      channelPromise.then((channel) => {
        if (channel) supabase.removeChannel(channel);
      });
    };
  }, [fetchNotifications]);

  const markAsRead = useCallback(async (id: string) => {
    const supabase = createClient();
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      toast.error(getUserErrorMessage(error, 'Failed to mark notification as read.'));
      return;
    }

    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n)),
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
  }, []);

  const markAllRead = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('is_read', false);

    if (error) {
      toast.error(getUserErrorMessage(error, 'Failed to mark all notifications as read.'));
      return;
    }

    setNotifications((prev) =>
      prev.map((n) => ({ ...n, is_read: true, read_at: new Date().toISOString() })),
    );
    setUnreadCount(0);
  }, []);

  return { notifications, unreadCount, loading, markAsRead, markAllRead, refetch: fetchNotifications };
}
