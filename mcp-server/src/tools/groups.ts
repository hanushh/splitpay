import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSupabaseClient, getCurrentUserId } from '../supabase-client.js';
import { ok, err, describeBalance } from '../utils.js';
import type { Group, GroupMember, GroupBalance } from '../types.js';

export function registerGroupTools(server: McpServer): void {
  // ── list_groups ────────────────────────────────────────────────────────────
  server.tool(
    'list_groups',
    'List all groups the current user belongs to, with their names, IDs, and balance status.',
    {},
    async () => {
      try {
        const client = getSupabaseClient();
        const userId = await getCurrentUserId();

        // Get group IDs the user belongs to
        const { data: memberships, error: memErr } = await client
          .from('group_members')
          .select('group_id')
          .eq('user_id', userId);

        if (memErr) throw memErr;
        if (!memberships || memberships.length === 0) {
          return ok({ groups: [], message: 'You are not a member of any groups.' });
        }

        const groupIds = memberships.map((m) => m.group_id as string);

        // Fetch groups
        const { data: groups, error: groupErr } = await client
          .from('groups')
          .select('id, name, description, icon_name, archived, created_at')
          .in('id', groupIds)
          .eq('archived', false)
          .order('created_at', { ascending: false });

        if (groupErr) throw groupErr;

        // Fetch balances for all groups
        const { data: balances, error: balErr } = await client
          .from('group_balances')
          .select('group_id, balance_cents, currency_code')
          .eq('user_id', userId)
          .in('group_id', groupIds);

        if (balErr) throw balErr;

        // Build a balance map per group
        const balanceMap: Record<string, GroupBalance[]> = {};
        for (const b of (balances ?? []) as GroupBalance[]) {
          if (!balanceMap[b.group_id]) balanceMap[b.group_id] = [];
          balanceMap[b.group_id].push(b);
        }

        const result = ((groups ?? []) as Group[]).map((g) => {
          const groupBalances = balanceMap[g.id] ?? [];
          const balanceSummary =
            groupBalances.length === 0
              ? 'settled up'
              : groupBalances
                  .map((b) => describeBalance(b.balance_cents, b.currency_code))
                  .join(', ');

          return {
            group_id: g.id,
            name: g.name,
            description: g.description,
            icon: g.icon_name,
            balance_summary: balanceSummary,
          };
        });

        return ok({ groups: result });
      } catch (e) {
        return err(e);
      }
    }
  );

  // ── get_group ──────────────────────────────────────────────────────────────
  server.tool(
    'get_group',
    'Get details about a specific group including its members.',
    { group_id: z.string().uuid().describe('The group ID') },
    async ({ group_id }) => {
      try {
        const client = getSupabaseClient();

        const { data: group, error: groupErr } = await client
          .from('groups')
          .select('id, name, description, icon_name, archived, created_at')
          .eq('id', group_id)
          .single();

        if (groupErr) throw groupErr;

        const g = group as unknown as Group;

        const { data: members, error: memErr } = await client
          .from('group_members')
          .select('id, user_id, display_name, avatar_url, joined_at')
          .eq('group_id', group_id)
          .order('joined_at', { ascending: true });

        if (memErr) throw memErr;

        return ok({
          group_id: g.id,
          name: g.name,
          description: g.description,
          icon: g.icon_name,
          archived: g.archived,
          created_at: g.created_at,
          members: ((members ?? []) as GroupMember[]).map((m) => ({
            member_id: m.id,
            display_name: m.display_name,
            is_app_user: m.user_id !== null,
            joined_at: m.joined_at,
          })),
        });
      } catch (e) {
        return err(e);
      }
    }
  );

  // ── create_group ───────────────────────────────────────────────────────────
  server.tool(
    'create_group',
    'Create a new expense-sharing group. The current user becomes the first member automatically.',
    {
      name: z.string().min(1).max(100).describe('Group name'),
      description: z.string().optional().describe('Optional group description'),
      icon_name: z.string().optional().describe('Optional icon name (e.g. "home", "car", "plane")'),
    },
    async ({ name, description, icon_name }) => {
      try {
        const client = getSupabaseClient();
        const userId = await getCurrentUserId();

        // Insert the group
        const { data: group, error: groupErr } = await client
          .from('groups')
          .insert({ name, description: description ?? null, icon_name: icon_name ?? null, created_by: userId })
          .select('id, name')
          .single();

        if (groupErr) throw groupErr;

        const newGroup = group as unknown as Pick<Group, 'id' | 'name'>;

        // Add the creator as a member
        const { error: memErr } = await client
          .from('group_members')
          .insert({ group_id: newGroup.id, user_id: userId });

        if (memErr) throw memErr;

        return ok({ group_id: newGroup.id, name: newGroup.name, message: `Group "${newGroup.name}" created successfully.` });
      } catch (e) {
        return err(e);
      }
    }
  );

  // ── list_group_members ─────────────────────────────────────────────────────
  server.tool(
    'list_group_members',
    'List all members of a group. Returns member IDs needed for creating expenses and recording settlements.',
    { group_id: z.string().uuid().describe('The group ID') },
    async ({ group_id }) => {
      try {
        const client = getSupabaseClient();
        const userId = await getCurrentUserId();

        const { data: members, error: memErr } = await client
          .from('group_members')
          .select('id, user_id, display_name, avatar_url, joined_at')
          .eq('group_id', group_id)
          .order('joined_at', { ascending: true });

        if (memErr) throw memErr;

        return ok({
          members: ((members ?? []) as GroupMember[]).map((m) => ({
            member_id: m.id,
            display_name: m.display_name ?? 'Unknown',
            is_app_user: m.user_id !== null,
            is_you: m.user_id === userId,
          })),
        });
      } catch (e) {
        return err(e);
      }
    }
  );
}
