import { supabase } from '@/lib/supabase';

/**
 * Finds the shared group with the largest absolute balance between the current
 * user and a friend. Returns null if no shared groups exist.
 */
export async function findTopSharedGroup(
  currentUserId: string,
  friendUserId: string,
): Promise<{ groupId: string; groupName: string } | null> {
  const [{ data: friendMemberships }, { data: myMemberships }] =
    await Promise.all([
      supabase
        .from('group_members')
        .select('group_id, groups!inner(name)')
        .eq('user_id', friendUserId),
      supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', currentUserId),
    ]);

  const friendGroupIds = new Set(
    ((friendMemberships as { group_id: string }[] | null) ?? []).map(
      (r) => r.group_id,
    ),
  );

  const sharedGroupIds = (
    (myMemberships as { group_id: string }[] | null) ?? []
  )
    .map((r) => r.group_id)
    .filter((id) => friendGroupIds.has(id));

  if (sharedGroupIds.length === 0) return null;

  const { data: balances } = await supabase
    .from('group_balances')
    .select('group_id, balance_cents')
    .eq('user_id', currentUserId)
    .in('group_id', sharedGroupIds);

  const topGroup = (
    (balances as { group_id: string; balance_cents: number }[] | null) ?? []
  ).sort((a, b) => Math.abs(b.balance_cents) - Math.abs(a.balance_cents))[0];

  const groupId = topGroup?.group_id ?? sharedGroupIds[0];
  const groupRow = (
    (friendMemberships as
      | { group_id: string; groups: { name: string } }[]
      | null) ?? []
  ).find((r) => r.group_id === groupId);

  return { groupId, groupName: groupRow?.groups?.name ?? 'Group' };
}
