import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSupabaseClient, getCurrentUserId } from '../supabase-client.js';
import { ok, err, dollarsToCents, centsToDisplay } from '../utils.js';
import type { GroupExpense } from '../types.js';

const CATEGORIES = ['restaurant', 'train', 'hotel', 'movie', 'store', 'other'] as const;

export function registerExpenseTools(server: McpServer): void {
  // ── list_expenses ──────────────────────────────────────────────────────────
  server.tool(
    'list_expenses',
    'List expenses in a group. Shows who paid, the total amount, and your share for each expense.',
    {
      group_id: z.string().uuid().describe('The group ID'),
      limit: z.number().int().positive().max(100).default(50).describe('Max number of expenses to return (default 50)'),
    },
    async ({ group_id, limit }) => {
      try {
        const client = getSupabaseClient();
        const userId = await getCurrentUserId();

        const { data, error } = await client
          .rpc('get_group_expenses', { p_group_id: group_id, p_user_id: userId });

        if (error) throw error;

        const expenses = ((data ?? []) as GroupExpense[]).slice(0, limit).map((e) => ({
          expense_id: e.expense_id,
          description: e.description,
          category: e.category,
          currency: e.currency_code,
          total_amount: centsToDisplay(e.total_amount_cents),
          your_share: centsToDisplay(e.your_split_cents),
          paid_by: e.paid_by_name,
          paid_by_is_you: e.paid_by_is_user,
          date: e.created_at,
        }));

        return ok({ expenses, count: expenses.length });
      } catch (e) {
        return err(e);
      }
    }
  );

  // ── create_expense ─────────────────────────────────────────────────────────
  server.tool(
    'create_expense',
    'Create a new expense in a group and split it among members. By default splits equally among all split_member_ids. Provide split_amounts (in dollars) for unequal splits — they must sum exactly to amount. Use list_group_members to get member IDs.',
    {
      group_id: z.string().uuid().describe('The group ID'),
      description: z.string().min(1).describe('Expense description (e.g. "Dinner at Sushi Palace")'),
      amount: z.number().positive().describe('Total expense amount in dollars (e.g. 45.00)'),
      paid_by_member_id: z.string().uuid().describe('Member ID of the person who paid'),
      split_member_ids: z
        .array(z.string().uuid())
        .min(1)
        .describe('Member IDs of everyone sharing this expense (include the payer if they have a share)'),
      split_amounts: z
        .array(z.number().positive())
        .optional()
        .describe('Custom per-member amounts in dollars. Must match split_member_ids length and sum to amount. Omit for equal split.'),
      category: z
        .enum(CATEGORIES)
        .default('other')
        .describe('Expense category'),
      currency_code: z
        .string()
        .length(3)
        .default('USD')
        .describe('ISO 4217 currency code (e.g. USD, INR, EUR)'),
    },
    async ({ group_id, description, amount, paid_by_member_id, split_member_ids, split_amounts, category, currency_code }) => {
      try {
        const client = getSupabaseClient();
        const amountCents = dollarsToCents(amount);
        const splitAmountsCents = split_amounts ? split_amounts.map(dollarsToCents) : null;

        if (splitAmountsCents) {
          const total = splitAmountsCents.reduce((a, b) => a + b, 0);
          if (total !== amountCents) {
            return err(`split_amounts must sum to amount (${amount}). Got ${total / 100}.`);
          }
        }

        const { data, error } = await client.rpc('create_expense_with_splits', {
          p_group_id: group_id,
          p_description: description,
          p_amount_cents: amountCents,
          p_paid_by_member_id: paid_by_member_id,
          p_category: category,
          p_receipt_url: null,
          p_split_member_ids: split_member_ids,
          p_split_amounts_cents: splitAmountsCents,
          p_currency_code: currency_code,
        });

        if (error) throw error;

        return ok({ expense_id: data as string, message: `Expense "${description}" for ${currency_code} ${amount.toFixed(2)} created successfully.` });
      } catch (e) {
        return err(e);
      }
    }
  );

  // ── update_expense ─────────────────────────────────────────────────────────
  server.tool(
    'update_expense',
    'Update an existing expense. Atomically reverses the old balance impact and applies the new one. All fields are required.',
    {
      expense_id: z.string().uuid().describe('The expense ID to update'),
      description: z.string().min(1).describe('New description'),
      amount: z.number().positive().describe('New total amount in dollars'),
      paid_by_member_id: z.string().uuid().describe('Member ID of the person who paid'),
      split_member_ids: z.array(z.string().uuid()).min(1).describe('Member IDs sharing the expense'),
      split_amounts: z
        .array(z.number().positive())
        .optional()
        .describe('Custom per-member dollar amounts. Must match split_member_ids length and sum to amount.'),
      category: z.enum(CATEGORIES).default('other').describe('Expense category'),
      currency_code: z.string().length(3).default('USD').describe('ISO 4217 currency code'),
    },
    async ({ expense_id, description, amount, paid_by_member_id, split_member_ids, split_amounts, category, currency_code }) => {
      try {
        const client = getSupabaseClient();
        const amountCents = dollarsToCents(amount);
        const splitAmountsCents = split_amounts ? split_amounts.map(dollarsToCents) : null;

        if (splitAmountsCents) {
          const total = splitAmountsCents.reduce((a, b) => a + b, 0);
          if (total !== amountCents) {
            return err(`split_amounts must sum to amount (${amount}). Got ${total / 100}.`);
          }
        }

        const { error } = await client.rpc('update_expense_with_splits', {
          p_expense_id: expense_id,
          p_description: description,
          p_amount_cents: amountCents,
          p_paid_by_member_id: paid_by_member_id,
          p_category: category,
          p_receipt_url: null,
          p_split_member_ids: split_member_ids,
          p_split_amounts_cents: splitAmountsCents,
          p_currency_code: currency_code,
        });

        if (error) throw error;

        return ok({ message: `Expense updated successfully.` });
      } catch (e) {
        return err(e);
      }
    }
  );

  // ── delete_expense ─────────────────────────────────────────────────────────
  server.tool(
    'delete_expense',
    'Delete an expense. Atomically reverses its balance impact before deletion.',
    { expense_id: z.string().uuid().describe('The expense ID to delete') },
    async ({ expense_id }) => {
      try {
        const client = getSupabaseClient();

        const { error } = await client.rpc('delete_expense', { p_expense_id: expense_id });

        if (error) throw error;

        return ok({ message: 'Expense deleted successfully.' });
      } catch (e) {
        return err(e);
      }
    }
  );
}
