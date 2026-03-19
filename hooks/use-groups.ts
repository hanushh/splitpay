import { useCallback, useEffect, useState } from 'react';
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

  const fetchGroups = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      // Step 1: Get the IDs of groups the current user belongs to
      const { data: memberships, error: membershipsErr } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', user.id);

      if (membershipsErr) throw new Error(membershipsErr.message);

      const memberGroupIds = (memberships ?? []).map((m) => m.group_id);

      if (memberGroupIds.length === 0) {
        setGroups([]);
        return;
      }

      // Step 2: Fetch only those groups (with all members and balances)
      const { data: groupRows, error: groupsErr } = await supabase
        .from('groups')
        .select(
          `
          id, name, description, image_url, icon_name, archived,
          group_balances!left ( balance_cents ),
          group_members ( id, display_name, avatar_url, user_id )
        `,
        )
        .in('id', memberGroupIds)
        .eq('archived', false)
        .order('created_at', { ascending: true });

      if (groupsErr) throw new Error(groupsErr.message);

      type RawMember = {
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        user_id: string | null;
      };

      // Collect user_ids that need profile lookup (joined via app, no display_name)
      const allRawMembers = (groupRows ?? []).flatMap(
        (row) => (row.group_members as RawMember[]) ?? [],
      );
      const userIdsNeedingProfile = [
        ...new Set(
          allRawMembers
            .filter(
              (m) => m.user_id && !m.display_name && m.user_id !== user.id,
            )
            .map((m) => m.user_id!),
        ),
      ];

      let profileMap: Record<
        string,
        { name: string; avatar_url: string | null }
      > = {};
      if (userIdsNeedingProfile.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, name, avatar_url')
          .in('id', userIdsNeedingProfile);
        profileMap = (profiles ?? []).reduce(
          (acc, p) => ({
            ...acc,
            [p.id]: { name: p.name ?? 'Unknown', avatar_url: p.avatar_url },
          }),
          {} as Record<string, { name: string; avatar_url: string | null }>,
        );
      }

      const mapped: Group[] = (groupRows ?? []).map((row) => {
        const balance_cents: number =
          (row.group_balances as { balance_cents: number }[] | null)?.[0]
            ?.balance_cents ?? 0;

        const status: GroupStatus =
          balance_cents > 0 ? 'owed' : balance_cents < 0 ? 'owes' : 'settled';

        const members: GroupMember[] = (
          (row.group_members as RawMember[]) ?? []
        )
          .filter((m) => m.user_id !== user.id)
          .map((m) => {
            if (m.user_id && !m.display_name && profileMap[m.user_id]) {
              return {
                id: m.id,
                display_name: profileMap[m.user_id].name,
                avatar_url: m.avatar_url ?? profileMap[m.user_id].avatar_url,
              };
            }
            return {
              id: m.id,
              display_name: m.display_name,
              avatar_url: m.avatar_url,
            };
          });

        return {
          id: row.id,
          name: row.name,
          description: row.description,
          image_url: row.image_url,
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
    if (!user) return;
    fetchGroups();
  }, [user, fetchGroups]);

  const totalBalanceCents = groups.reduce((sum, g) => sum + g.balance_cents, 0);

  return { groups, loading, error, refetch: fetchGroups, totalBalanceCents };
}
