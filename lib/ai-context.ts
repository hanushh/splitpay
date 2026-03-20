import { supabase } from '@/lib/supabase';

interface GroupRow {
  id: string;
  name: string;
  balance_cents: number;
  members: string[];
}

interface FriendBalance {
  name: string;
  balance_cents: number;
  currency_code: string;
}

interface RecentExpense {
  description: string;
  group_name: string;
  amount_cents: number;
  paid_by_name: string;
  created_at: string;
}

function formatCents(cents: number): string {
  const abs = Math.abs(cents / 100);
  return `$${abs.toFixed(2)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export async function buildRagContext(
  userId: string,
  userName: string,
): Promise<string> {
  const lines: string[] = [
    `## Current User`,
    `Name: ${userName}`,
    '',
  ];

  try {
    // ── Groups + balances ──────────────────────────────────────────────────
    const { data: memberships } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', userId);

    const groupIds = (memberships ?? []).map((m) => m.group_id as string);

    const groups: GroupRow[] = [];

    if (groupIds.length > 0) {
      const { data: groupRows } = await supabase
        .from('groups')
        .select(
          `id, name, archived,
           group_balances!left ( balance_cents, currency_code ),
           group_members ( id, display_name, user_id )`,
        )
        .in('id', groupIds)
        .eq('archived', false);

      type RawMember = { id: string; display_name: string | null; user_id: string | null };
      type RawBalance = { balance_cents: number; currency_code: string };

      for (const row of groupRows ?? []) {
        const balanceRows = (row.group_balances as RawBalance[] | null) ?? [];
        const primary = balanceRows
          .filter((b) => b.balance_cents !== 0)
          .sort((a, b) => Math.abs(b.balance_cents) - Math.abs(a.balance_cents))[0];
        const balanceCents = primary?.balance_cents ?? 0;

        const members = ((row.group_members as RawMember[]) ?? [])
          .filter((m) => m.user_id !== userId)
          .map((m) => m.display_name ?? 'Unknown');

        groups.push({
          id: row.id as string,
          name: row.name as string,
          balance_cents: balanceCents,
          members,
        });
      }
    }

    lines.push('## Your Groups');
    if (groups.length === 0) {
      lines.push('You have no active groups.');
    } else {
      for (const g of groups) {
        const balanceLine =
          g.balance_cents > 0
            ? `you are owed ${formatCents(g.balance_cents)}`
            : g.balance_cents < 0
              ? `you owe ${formatCents(g.balance_cents)}`
              : 'settled';

        const membersStr =
          g.members.length > 0 ? g.members.join(', ') : 'just you';
        lines.push(
          `- ${g.name} | Group ID: ${g.id} | ${balanceLine} | Members: ${membersStr}`,
        );
      }
    }
    lines.push('');

    // ── Friend balances ────────────────────────────────────────────────────
    const { data: friendData } = await supabase.rpc('get_friend_balances', {
      p_user_id: userId,
    });

    const friends: FriendBalance[] = [];
    if (Array.isArray(friendData)) {
      for (const row of friendData as Record<string, unknown>[]) {
        const balance_cents = Number(row.balance_cents ?? 0);
        if (balance_cents === 0) continue;
        friends.push({
          name: (row.display_name as string) ?? 'Unknown',
          balance_cents,
          currency_code: (row.currency_code as string) ?? 'INR',
        });
      }
    }

    lines.push('## Friend Balances');
    if (friends.length === 0) {
      lines.push('No outstanding balances with friends.');
    } else {
      for (const f of friends) {
        const dir =
          f.balance_cents > 0
            ? `you are owed ${formatCents(f.balance_cents)} ${f.currency_code}`
            : `you owe ${formatCents(f.balance_cents)} ${f.currency_code}`;
        lines.push(`- ${f.name}: ${dir}`);
      }
    }
    lines.push('');

    // ── Recent expenses ────────────────────────────────────────────────────
    const recentExpenses: RecentExpense[] = [];

    if (groupIds.length > 0) {
      const { data: expenseRows } = await supabase
        .from('expenses')
        .select(
          `description, amount_cents, created_at,
           groups ( name ),
           group_members!paid_by_member_id ( display_name )`,
        )
        .in('group_id', groupIds)
        .order('created_at', { ascending: false })
        .limit(20);

      for (const row of expenseRows ?? []) {
        const grp = (row.groups as unknown as { name: string } | null);
        const paidBy = (row.group_members as unknown as { display_name: string | null } | null);
        recentExpenses.push({
          description: (row.description as string) ?? '',
          group_name: grp?.name ?? 'Unknown group',
          amount_cents: Number(row.amount_cents ?? 0),
          paid_by_name: paidBy?.display_name ?? 'Unknown',
          created_at: (row.created_at as string) ?? '',
        });
      }
    }

    lines.push('## Recent Expenses (last 20)');
    if (recentExpenses.length === 0) {
      lines.push('No expenses yet.');
    } else {
      for (const e of recentExpenses) {
        lines.push(
          `- "${e.description}" in ${e.group_name} — ${formatCents(e.amount_cents)} paid by ${e.paid_by_name} on ${formatDate(e.created_at)}`,
        );
      }
    }
    lines.push('');

    // ── Overall balance ────────────────────────────────────────────────────
    const totalCents = groups.reduce((sum, g) => sum + g.balance_cents, 0);
    const totalLine =
      totalCents > 0
        ? `You are owed ${formatCents(totalCents)} overall.`
        : totalCents < 0
          ? `You owe ${formatCents(totalCents)} overall.`
          : 'You are all settled up overall.';

    lines.push(`## Overall Balance`);
    lines.push(totalLine);
  } catch {
    lines.push('(Could not load some data — please try again.)');
  }

  return lines.join('\n');
}

export function buildSystemPrompt(context: string, today: string): string {
  return `You are an AI assistant built into PaySplit, a bill-splitting app.
Today's date: ${today}.

${context}

Guidelines:
- Answer questions about balances, expenses, and groups using the data above.
- Use the provided tools to open screens when the user wants to take an action.
- Before calling a tool, briefly tell the user what you are about to do.
- Keep responses concise and friendly.
- Refer to money amounts using the values from the data (already formatted in USD).
- If data is missing, ask the user for clarification rather than guessing IDs.`;
}
