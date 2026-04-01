import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSupabaseClient, getCurrentUserId } from '../supabase-client.js';
import { ok, err, centsToDisplay } from '../utils.js';
import type { MemberBalance, FriendBalance } from '../types.js';

export function registerBalanceTools(server: McpServer): void {
  // ── get_group_balances ─────────────────────────────────────────────────────
  server.tool(
    'get_group_balances',
    'Show who owes what within a specific group. Positive balance = that member owes you. Negative = you owe them.',
    { group_id: z.string().uuid().describe('The group ID') },
    async ({ group_id }) => {
      try {
        const client = getSupabaseClient();
        const userId = await getCurrentUserId();

        const { data, error } = await client
          .rpc('get_group_member_balances', { p_group_id: group_id, p_user_id: userId });

        if (error) throw error;

        const balances = ((data ?? []) as MemberBalance[]).map((b) => {
          const amount = centsToDisplay(b.balance_cents);
          const currency = b.currency_code ?? 'USD';
          let summary: string;
          if (b.balance_cents > 0) summary = `owes you ${currency} ${amount}`;
          else if (b.balance_cents < 0) summary = `you owe ${currency} ${amount}`;
          else summary = 'settled up';

          return {
            member_id: b.member_id,
            name: b.display_name ?? 'Unknown',
            balance_dollars: parseFloat((b.balance_cents / 100).toFixed(2)),
            currency,
            summary,
          };
        });

        return ok({ group_id, balances });
      } catch (e) {
        return err(e);
      }
    }
  );

  // ── get_friend_balances ────────────────────────────────────────────────────
  server.tool(
    'get_friend_balances',
    'Show your consolidated balance with each person across all groups. Positive = they owe you overall. Negative = you owe them.',
    {},
    async () => {
      try {
        const client = getSupabaseClient();
        const userId = await getCurrentUserId();

        const { data, error } = await client
          .rpc('get_friend_balances', { p_user_id: userId });

        if (error) throw error;

        const balances = ((data ?? []) as FriendBalance[]).map((b) => {
          const amount = centsToDisplay(b.balance_cents);
          const currency = b.currency_code ?? 'USD';
          let summary: string;
          if (b.balance_cents > 0) summary = `owes you ${currency} ${amount}`;
          else if (b.balance_cents < 0) summary = `you owe ${currency} ${amount}`;
          else summary = 'settled up';

          return {
            user_id: b.friend_user_id,
            name: b.friend_name ?? 'Unknown',
            balance_dollars: parseFloat((b.balance_cents / 100).toFixed(2)),
            currency,
            summary,
          };
        });

        const totalOwed = balances
          .filter((b) => b.balance_dollars > 0)
          .reduce((s: number, b) => s + b.balance_dollars, 0);
        const totalOwing = balances
          .filter((b) => b.balance_dollars < 0)
          .reduce((s: number, b) => s + b.balance_dollars, 0);

        return ok({ balances, total_owed: totalOwed.toFixed(2), total_owing: Math.abs(totalOwing).toFixed(2) });
      } catch (e) {
        return err(e);
      }
    }
  );
}
