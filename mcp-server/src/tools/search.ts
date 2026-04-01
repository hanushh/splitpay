import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSupabaseClient, getCurrentUserId } from '../supabase-client.js';
import { ok, err } from '../utils.js';
import type { AppUser, GroupMember } from '../types.js';

export function registerSearchTools(server: McpServer): void {
  // ── search_users ───────────────────────────────────────────────────────────
  server.tool(
    'search_users',
    'Search for PaySplit users by name or email. Returns user IDs useful for adding members to groups.',
    { query: z.string().min(2).describe('Search query (name or email, min 2 characters)') },
    async ({ query }) => {
      try {
        const client = getSupabaseClient();

        const { data, error } = await client
          .rpc('search_app_users', { p_query: query });

        if (error) throw error;

        return ok({
          users: ((data ?? []) as AppUser[]).map((u) => ({
            user_id: u.user_id,
            name: u.display_name ?? 'Unknown',
          })),
        });
      } catch (e) {
        return err(e);
      }
    }
  );

  // ── search_group_members ───────────────────────────────────────────────────
  server.tool(
    'search_group_members',
    'Search for members within a specific group by name. Returns member IDs needed for create_expense (paid_by_member_id, split_member_ids) and record_settlement (payee_member_id).',
    {
      group_id: z.string().uuid().describe('The group ID to search within'),
      query: z.string().optional().describe('Optional name filter. Omit to list all members.'),
    },
    async ({ group_id, query }) => {
      try {
        const client = getSupabaseClient();
        const userId = await getCurrentUserId();

        let q = client
          .from('group_members')
          .select('id, user_id, display_name, avatar_url')
          .eq('group_id', group_id);

        if (query && query.length > 0) {
          q = q.ilike('display_name', `%${query}%`);
        }

        const { data, error } = await q;

        if (error) throw error;

        return ok({
          members: ((data ?? []) as GroupMember[]).map((m) => ({
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
