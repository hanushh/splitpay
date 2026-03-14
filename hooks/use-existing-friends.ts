import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/auth';
import { supabase } from '@/lib/supabase';

export interface ExistingFriend {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

export function useExistingFriends() {
  const { user } = useAuth();
  const [friends, setFriends] = useState<ExistingFriend[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    try {
      // Step 1: get groups the current user belongs to
      const { data: memberships, error: memErr } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', user.id);

      if (memErr || !memberships?.length) {
        setFriends([]);
        return;
      }

      const groupIds = memberships.map((m) => m.group_id);

      // Step 2: get all unique app users in those groups (excluding self)
      const { data: members, error: memberErr } = await supabase
        .from('group_members')
        .select('user_id, display_name, avatar_url')
        .in('group_id', groupIds)
        .neq('user_id', user.id)
        .not('user_id', 'is', null);

      if (memberErr || !members) {
        setFriends([]);
        return;
      }

      // Deduplicate by user_id, preferring rows with a display_name
      const seen = new Map<string, ExistingFriend>();
      for (const m of members) {
        const existing = seen.get(m.user_id);
        if (!existing || (!existing.displayName && m.display_name)) {
          seen.set(m.user_id, {
            userId: m.user_id,
            displayName: m.display_name ?? 'Unknown',
            avatarUrl: m.avatar_url ?? null,
          });
        }
      }

      setFriends(Array.from(seen.values()).sort((a, b) =>
        a.displayName.localeCompare(b.displayName)
      ));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);

  return { friends, loading };
}
