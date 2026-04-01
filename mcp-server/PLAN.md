# Plan: MCP Server for PaySplit

## Context

Build a standalone Model Context Protocol (MCP) server so AI assistants (Claude Desktop, Claude Code) can read and write PaySplit data — list groups, view expenses and balances, add expenses, record settlements, etc. — using natural language.

The server lives in a new `mcp-server/` subdirectory, completely independent of the React Native app, and connects to Supabase using a user JWT passed via environment variable.

---

## Authentication Approach

Use a user JWT (`SUPABASE_USER_JWT`) passed as the `Authorization: Bearer` header on the Supabase client. This is the only option that:
- Respects all existing RLS policies (users only see their groups)
- Makes `auth.uid()` return the correct value inside `SECURITY DEFINER` RPCs
- Works without storing passwords (supports Google OAuth accounts too)

```ts
_client = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${userJwt}` } },
});
```

---

## Directory Structure

```
mcp-server/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── index.ts              # Entry point — creates McpServer, registers all tools, starts STDIO transport
│   ├── supabase-client.ts    # Authenticated Supabase singleton + getCurrentUserId() helper
│   ├── types.ts              # Lean interfaces for RPC return types (no Expo/RN imports)
│   ├── utils.ts              # centsToDisplay(), dollarsToCents(), formatError()
│   └── tools/
│       ├── groups.ts         # list_groups, get_group, create_group, list_group_members
│       ├── expenses.ts       # list_expenses, create_expense, update_expense, delete_expense
│       ├── balances.ts       # get_group_balances, get_friend_balances
│       ├── activity.ts       # get_activity
│       ├── settlements.ts    # record_settlement
│       └── search.ts         # search_users, search_group_members
└── dist/                     # Compiled output (gitignored)
```

---

## package.json (key parts)

```json
{
  "name": "paysplit-mcp-server",
  "type": "module",
  "scripts": { "build": "tsc", "dev": "tsx src/index.ts", "start": "node dist/index.js" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.16.0",
    "@supabase/supabase-js": "^2.49.4",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "~5.9.2"
  }
}
```

---

## 14 Tools to Implement

### Groups (`src/tools/groups.ts`)
| Tool | Inputs | Supabase call |
|---|---|---|
| `list_groups` | — | `group_members` join `groups` join `group_balances` |
| `get_group` | `group_id` | `groups` + `group_members` select |
| `create_group` | `name, description?, icon_name?` | `groups` insert → `group_members` insert |
| `list_group_members` | `group_id` | `group_members` select with profile join |

### Expenses (`src/tools/expenses.ts`)
| Tool | Inputs | Supabase call |
|---|---|---|
| `list_expenses` | `group_id, limit?` | `rpc('get_group_expenses', {p_group_id, p_user_id})` |
| `create_expense` | `group_id, description, amount, paid_by_member_id, split_member_ids, split_amounts?, category?, currency_code?` | `rpc('create_expense_with_splits', {...})` |
| `update_expense` | same as create + `expense_id` instead of `group_id` | `rpc('update_expense_with_splits', {...})` |
| `delete_expense` | `expense_id` | `rpc('delete_expense', {p_expense_id})` |

**Verified RPC signatures (from migrations):**
- `create_expense_with_splits(p_group_id, p_description, p_amount_cents, p_paid_by_member_id, p_category, p_receipt_url, p_split_member_ids, p_split_amounts_cents DEFAULT NULL, p_currency_code DEFAULT 'INR')` → UUID
- `update_expense_with_splits(p_expense_id, p_description, p_amount_cents, p_paid_by_member_id, p_category, p_receipt_url, p_split_member_ids, p_split_amounts_cents DEFAULT NULL, p_currency_code DEFAULT 'INR')` → VOID
- `delete_expense(p_expense_id)` → VOID

### Balances (`src/tools/balances.ts`)
| Tool | Inputs | Supabase call |
|---|---|---|
| `get_group_balances` | `group_id` | `rpc('get_group_member_balances', {p_group_id, p_user_id})` |
| `get_friend_balances` | — | `rpc('get_friend_balances', {p_user_id})` |

### Activity (`src/tools/activity.ts`)
| Tool | Inputs | Supabase call |
|---|---|---|
| `get_activity` | `limit?` | `rpc('get_user_activity', {p_user_id, p_limit})` |

### Settlements (`src/tools/settlements.ts`)
| Tool | Inputs | Supabase call |
|---|---|---|
| `record_settlement` | `group_id, payee_member_id, amount, payment_method?, note?, currency_code?` | `rpc('record_settlement', {p_group_id, p_payee_member_id, p_amount_cents, p_payment_method, p_note, p_currency_code})` |

**Note:** `record_settlement` signature: `(p_group_id, p_payee_member_id, p_amount_cents, p_payment_method DEFAULT 'cash', p_note DEFAULT NULL, p_payer_member_id DEFAULT NULL, p_currency_code DEFAULT 'INR')`. The payer is derived from `auth.uid()` when `p_payer_member_id` is NULL — correct behavior with our JWT approach.

### Search (`src/tools/search.ts`)
| Tool | Inputs | Supabase call |
|---|---|---|
| `search_users` | `query` | `rpc('search_app_users', {p_query})` |
| `search_group_members` | `group_id, query?` | `group_members` select with `.ilike('display_name', '%query%')` |

---

## Amount Handling

- All tool **inputs** accept **dollars** (float, e.g. `12.50`)
- Convert to cents before any RPC: `Math.round(dollars * 100)`
- All tool **outputs** return dollars as formatted strings
- Always pass `currency_code` explicitly (do not rely on `DEFAULT 'INR'`)

---

## User ID Resolution

Cache user ID to avoid redundant network calls:

```ts
let _userId: string | null = null;
export async function getCurrentUserId(client): Promise<string> {
  if (_userId) return _userId;
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('Invalid or expired JWT');
  _userId = data.user.id;
  return _userId;
}
```

---

## Claude Desktop / Claude Code Config

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "paysplit": {
      "command": "node",
      "args": ["/Users/hnair/Documents/Projects/splitwise/mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://yapfqffhgcncqxovjcsr.supabase.co",
        "SUPABASE_ANON_KEY": "<anon-key>",
        "SUPABASE_USER_JWT": "<user-jwt>"
      }
    }
  }
}
```

**Dev (no build):** use `"command": "npx"`, `"args": ["tsx", "./mcp-server/src/index.ts"]`

---

## Critical Files

- `supabase/migrations/20260320000002_add_currency_to_expenses.sql` — `create_expense_with_splits` signature with `p_split_amounts_cents` and `p_currency_code`
- `supabase/migrations/20260322000001_update_expense_with_splits.sql` — `update_expense_with_splits` signature
- `supabase/migrations/20260321000000_multi_currency_balances.sql` — `record_settlement` and `delete_expense` signatures
- `lib/database.types.ts` — auto-generated types for reference
- `supabase/functions/ai-chat/index.ts` — reference for Bearer JWT auth pattern

---

## Implementation Order

1. Scaffold: `package.json`, `tsconfig.json`, `src/index.ts` (empty server), `supabase-client.ts`, `utils.ts`, `types.ts` — verify server starts
2. Read-only tools: groups, balances, activity, search — test with Claude
3. Write tools: create_expense, update_expense, delete_expense, record_settlement, create_group
4. Add `.env.example`

---

## Verification

```bash
cd mcp-server
pnpm install
cp .env.example .env   # fill in values
pnpm dev               # server should start silently (STDIO — no output until a client connects)
pnpm build             # tsc compilation must succeed with no errors
```

Test via Claude Desktop or Claude Code after adding MCP config. Ask: "List my PaySplit groups" to verify auth + read works, then "Add a $20 dinner expense" to verify writes.
