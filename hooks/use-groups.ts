import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/auth';

export type GroupStatus = 'owed' | 'owes' | 'settled';

export interface GroupMember {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  bg_color: string;
  icon_name: string | null;
  archived: boolean;
  status: GroupStatus;
  /** Raw balance in cents: positive = owed to user, negative = user owes */
  balance_cents: number;
  members: GroupMember[];
}

export function useGroups() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initializedRef = useRef(false);

  const fetchGroups = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      const { data: groupRows, error: groupsErr } = await supabase
        .from('groups')
        .select(`
          id, name, description, image_url, bg_color, icon_name, archived,
          group_balances!left ( balance_cents ),
          group_members!inner ( id, display_name, avatar_url, user_id )
        `)
        .eq('archived', false)
        .order('created_at', { ascending: true });

      if (groupsErr) throw new Error(groupsErr.message);

      const seenGroupIds = new Set<string>();
      const mapped: Group[] = (groupRows ?? []).filter((row) => {
        if (seenGroupIds.has(row.id)) return false;
        seenGroupIds.add(row.id);
        return true;
      }).map((row) => {
        const balance_cents: number =
          (row.group_balances as { balance_cents: number }[] | null)?.[0]?.balance_cents ?? 0;

        const status: GroupStatus =
          balance_cents > 0 ? 'owed' : balance_cents < 0 ? 'owes' : 'settled';

        const members: GroupMember[] = (
          (row.group_members as {
            id: string;
            display_name: string | null;
            avatar_url: string | null;
            user_id: string | null;
          }[]) ?? []
        )
          .filter((m) => m.user_id !== user.id && m.avatar_url)
          .map((m) => ({ id: m.id, display_name: m.display_name, avatar_url: m.avatar_url }));

        return {
          id: row.id,
          name: row.name,
          description: row.description,
          image_url: row.image_url,
          bg_color: row.bg_color ?? 'rgba(99,102,241,0.25)',
          icon_name: row.icon_name,
          archived: row.archived ?? false,
          status,
          balance_cents,
          members,
        };
      });

      setGroups(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load groups');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user || initializedRef.current) return;
    initializedRef.current = true;

    const init = async () => {
      await supabase.rpc('initialize_demo_data', { p_user_id: user.id });
      await fetchGroups();
    };

    init();
  }, [user, fetchGroups]);

  const totalBalanceCents = groups.reduce((sum, g) => sum + g.balance_cents, 0);

  return { groups, loading, error, refetch: fetchGroups, totalBalanceCents };
}
