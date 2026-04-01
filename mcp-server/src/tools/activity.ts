import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSupabaseClient, getCurrentUserId } from '../supabase-client.js';
import { ok, err, centsToDisplay } from '../utils.js';
import type { ActivityItem } from '../types.js';

export function registerActivityTools(server: McpServer): void {
  server.tool(
    'get_activity',
    'Get recent expense and settlement activity across all your groups. Shows who paid, amounts, your share, and the group.',
    {
      limit: z.number().int().positive().max(100).default(20).describe('Number of recent items to return (default 20)'),
    },
    async ({ limit }) => {
      try {
        const client = getSupabaseClient();
        const userId = await getCurrentUserId();

        const { data, error } = await client
          .rpc('get_user_activity', { p_user_id: userId, p_limit: limit });

        if (error) throw error;

        const items = ((data ?? []) as ActivityItem[]).map((item) => ({
          type: item.category === 'settlement' ? 'settlement' : 'expense',
          group_name: item.group_name,
          group_id: item.group_id,
          expense_id: item.expense_id,
          description: item.description,
          category: item.category,
          currency: item.currency_code,
          total_amount: centsToDisplay(item.total_amount_cents),
          your_share: centsToDisplay(item.your_split_cents),
          paid_by: item.paid_by_name,
          paid_by_is_you: item.paid_by_is_user,
          date: item.created_at,
        }));

        return ok({ activity: items, count: items.length });
      } catch (e) {
        return err(e);
      }
    }
  );
}
