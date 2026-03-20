import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/auth';
import { type CurrencyBalance, deriveBalanceStatus, sortBalancesDesc } from '@/lib/balance-utils';
import { Group, GroupMember } from './use-groups';

export function useArchivedGroups() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchArchivedGroups = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
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

      const { data: groupRows, error: groupsErr } = await supabase
        .from('groups')
        .select(
          `
          id, name, description, image_url, icon_name, archived,
          group_balances!left ( balance_cents, currency_code ),
          group_members ( id, display_name, avatar_url, user_id )
        `,
        )
        .in('id', memberGroupIds)
        .eq('archived', true)
        .order('created_at', { ascending: false });

      if (groupsErr) throw new Error(groupsErr.message);

      type RawMember = {
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        user_id: string | null;
      };

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
        type RawBalance = { balance_cents: number; currency_code: string };
        const balances: CurrencyBalance[] = sortBalancesDesc(
          ((row.group_balances as RawBalance[] | null) ?? [])
            .filter((b) => b.balance_cents !== 0)
            .map((b) => ({
              currency_code: b.currency_code,
              balance_cents: Number(b.balance_cents),
            })),
        );
        const status = deriveBalanceStatus(balances);

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
          archived: true,
          status,
          balances,
          members,
        };
      });

      setGroups(mapped);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load archived groups',
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  return { groups, loading, error, fetch: fetchArchivedGroups };
}
