import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/auth';

export interface AdminStats {
  total_users: number;
  total_groups: number;
  total_expenses: number;
  total_expense_amount_cents: number;
  new_users_today: number;
  active_groups: number;
}

export interface AdminUser {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  created_at: string;
  is_admin: boolean;
  group_count: number;
  expense_count: number;
}

export interface AdminActivityItem {
  id: string;
  type: string;
  description: string;
  amount_cents: number;
  group_name: string;
  user_name: string;
  user_id: string | null;
  created_at: string;
}

/** Checks whether the signed-in user is an app admin. */
export function useAdminCheck() {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        setIsAdmin(data?.is_admin ?? false);
        setLoading(false);
      });
  }, [user?.id]);

  return { isAdmin, loading };
}

/** Fetches all admin dashboard data (stats, users, activity). */
export function useAdminData() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [activity, setActivity] = useState<AdminActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, usersRes, activityRes] = await Promise.all([
        supabase.rpc('get_admin_stats'),
        supabase.rpc('get_admin_users', { p_limit: 100 }),
        supabase.rpc('get_admin_activity', { p_limit: 50 }),
      ]);
      if (statsRes.error) throw statsRes.error;
      if (usersRes.error) throw usersRes.error;
      if (activityRes.error) throw activityRes.error;
      setStats((statsRes.data as AdminStats[] | null)?.[0] ?? null);
      setUsers((usersRes.data as AdminUser[] | null) ?? []);
      setActivity((activityRes.data as AdminActivityItem[] | null) ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return { stats, users, activity, loading, error, refetch: fetchAll };
}
