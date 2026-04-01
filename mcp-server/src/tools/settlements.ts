import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSupabaseClient } from '../supabase-client.js';
import { ok, err, dollarsToCents } from '../utils.js';

export function registerSettlementTools(server: McpServer): void {
  server.tool(
    'record_settlement',
    'Record that you paid someone back (or they paid you). The current user is always the payer. Use list_group_members to find the payee_member_id.',
    {
      group_id: z.string().uuid().describe('The group ID where the settlement occurs'),
      payee_member_id: z.string().uuid().describe('Member ID of the person receiving the payment'),
      amount: z.number().positive().describe('Amount paid in dollars (e.g. 25.00)'),
      payment_method: z
        .enum(['cash', 'venmo', 'other'])
        .default('cash')
        .describe('How the payment was made'),
      note: z.string().optional().describe('Optional note about the payment'),
      currency_code: z
        .string()
        .length(3)
        .default('USD')
        .describe('ISO 4217 currency code (e.g. USD, INR, EUR)'),
    },
    async ({ group_id, payee_member_id, amount, payment_method, note, currency_code }) => {
      try {
        const client = getSupabaseClient();
        const amountCents = dollarsToCents(amount);

        const { data, error } = await client.rpc('record_settlement', {
          p_group_id: group_id,
          p_payee_member_id: payee_member_id,
          p_amount_cents: amountCents,
          p_payment_method: payment_method,
          p_note: note ?? null,
          p_currency_code: currency_code,
        });

        if (error) throw error;

        return ok({
          settlement_id: data as string,
          message: `Settlement of ${currency_code} ${amount.toFixed(2)} recorded successfully.`,
        });
      } catch (e) {
        return err(e);
      }
    }
  );
}
