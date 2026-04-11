# Friends Tab — Design Spec

**Date:** 2026-03-12
**Status:** Approved

---

## Overview

Add a "Friends" tab to the bottom navigator. The screen reads the user's device contacts, matches them against app users by email and phone number, and displays two sections: contacts already on PaySplit and contacts who haven't joined yet. Users can view shared balances and add on-app friends to groups, or invite off-app contacts via the native share sheet.

---

## Dependencies

`expo-contacts` is not currently installed. Before implementation:

```bash
pnpm add expo-contacts
```

Add the plugin to `app.json` plugins array:

```json
[
  "expo-contacts",
  {
    "contactsPermission": "Allow PaySplit to access your contacts to find friends on the app."
  }
]
```

This adds the `NSContactsUsageDescription` key on iOS and the `READ_CONTACTS` permission on Android automatically.

---

## Database

### 1. Add `phone` to `profiles`

Migration name: `add_phone_to_profiles`

```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;
```

- Nullable text column
- Stores E.164 normalized phone numbers (e.g. `+14155552671`)
- Populated when a user adds their phone number (future profile edit) or at signup if provided
- No uniqueness constraint (users may share a phone in edge cases)

### 2. Extend `get_friend_balances` to return `user_id`

Migration name: `get_friend_balances_add_user_id`

The existing `get_friend_balances` groups by `display_name` and does not return `user_id`. The Friends screen needs `user_id` to join against `match_contacts` results.

Add `user_id uuid` to the return table and `SELECT` clause:

```sql
CREATE OR REPLACE FUNCTION public.get_friend_balances(p_user_id UUID)
RETURNS TABLE (
  user_id       UUID,
  display_name  TEXT,
  avatar_url    TEXT,
  balance_cents BIGINT
)
LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH my_members AS (
    SELECT id AS member_id, group_id
    FROM public.group_members WHERE user_id = p_user_id
  ),
  owed_to_me AS (
    SELECT es.member_id, es.amount_cents::BIGINT
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    JOIN my_members mm ON mm.member_id = e.paid_by_member_id AND mm.group_id = e.group_id
    WHERE es.member_id != e.paid_by_member_id
  ),
  i_owe AS (
    SELECT e.paid_by_member_id AS member_id, es.amount_cents::BIGINT
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    JOIN my_members mm ON mm.member_id = es.member_id AND mm.group_id = e.group_id
    WHERE e.paid_by_member_id != es.member_id
  ),
  combined AS (
    SELECT member_id,  amount_cents AS balance_cents FROM owed_to_me
    UNION ALL
    SELECT member_id, -amount_cents AS balance_cents FROM i_owe
  )
  SELECT
    gm.user_id,
    gm.display_name,
    MAX(gm.avatar_url) AS avatar_url,
    SUM(c.balance_cents) AS balance_cents
  FROM combined c
  JOIN public.group_members gm ON gm.id = c.member_id
  WHERE (gm.user_id IS NULL OR gm.user_id != p_user_id)
  GROUP BY gm.user_id, gm.display_name
  ORDER BY ABS(SUM(c.balance_cents)) DESC;
$$;
```

`user_id` is nullable in `group_members` (external contacts have no account), so this column will be `NULL` for non-app members. The hook filters to rows where `user_id IS NOT NULL` when joining with `match_contacts` results.

### 3. New RPC: `match_contacts`

Migration name: `add_match_contacts_rpc`

```sql
CREATE OR REPLACE FUNCTION public.match_contacts(
  p_emails  text[],
  p_phones  text[]
)
RETURNS TABLE (id uuid, name text, avatar_url text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT p.id, p.name, p.avatar_url
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE
      p.id <> auth.uid()
      AND (
        u.email = ANY(p_emails)
        OR p.phone = ANY(p_phones)
      );
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_contacts(text[], text[]) TO authenticated;
```

**Privacy note:** This function intentionally allows any authenticated user to discover which of their contacts have accounts on the platform. This is a standard and expected behaviour for a contacts-matching feature (the same model used by WhatsApp, Venmo, etc.). The server returns only `id`, `name`, `avatar_url` — no emails or phone numbers are leaked back to the client.

### 4. Regenerate TypeScript types

After applying all migrations:

```bash
# See .agents/workflows/update-supabase-types.md for full steps
```

### Migration summary

All three migrations created via `supabase migration new <name>` and pushed via `supabase db push`:

1. `add_phone_to_profiles`
2. `get_friend_balances_add_user_id`
3. `add_match_contacts_rpc`

---

## Data Layer

### `hooks/use-friends.ts`

Manages the full pipeline. Returns:

```typescript
interface MatchedFriend {
  userId: string;
  name: string;
  avatarUrl: string | null;
  balanceCents: number;
  balanceStatus: 'owed' | 'owes' | 'settled' | 'no_groups';
}

interface UnmatchedContact {
  name: string;
  phoneNumbers: string[];
  emails: string[];
}

interface UseFriendsResult {
  matched: MatchedFriend[];
  unmatched: UnmatchedContact[];
  loading: boolean;
  error: string | null;
  permissionDenied: boolean;
  refetch: () => Promise<void>;
}
```

**Pipeline steps:**

1. Call `requestPermissionsAsync()` from `expo-contacts`
2. If denied → set `permissionDenied: true`, clear loading, return early (do not throw)
3. Read all contacts via `getContactsAsync({ fields: [Fields.Emails, Fields.PhoneNumbers, Fields.Name] })`
4. Extract unique emails (lowercased) and unique phone numbers (normalized to E.164 via `normalizePhone`)
5. Call `match_contacts(p_emails, p_phones)` RPC
6. Call `get_friend_balances(p_user_id)` RPC
7. Join: for each matched profile (from step 5), find the row in step 6 where `user_id === profile.id`; if no match, set `balanceStatus: 'no_groups'` and `balanceCents: 0`
8. Build `unmatched`: contacts whose emails/phones produced no match in step 5 (client-side set difference by comparing against matched `id` set)
9. Sort `matched` by absolute `balanceCents` descending; sort `unmatched` alphabetically by name

**`refetch` behaviour:** `refetch` re-runs the full pipeline from step 1 (including the permission check). This means `useFocusEffect` in the screen can safely call `refetch()` unconditionally — if permission was just granted in Settings, the pipeline will proceed; if still denied, `permissionDenied` is set again.

**Phone normalization — `normalizePhone(raw: string): string | null`:**

Pure function, exported for independent unit testing:

```typescript
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`; // US 10-digit
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`; // US with leading 1
  if (digits.length > 6) return `+${digits}`; // assume already has country code
  return null; // too short, discard
}
```

**Known limitation:** Numbers from non-US devices stored in local format (e.g. UK `07700900123`) will be incorrectly normalized to `+07700900123` instead of `+447700900123`. This is acceptable for the current scope. `DEFAULT_COUNTRY_CODE = '+1'` is defined as a constant in `lib/app-config.ts` for easy future configuration.

**Mock for Jest:** Create `lib/__mocks__/expo-contacts.ts` exporting mocks for `requestPermissionsAsync`, `getContactsAsync`, and the `PermissionStatus` enum. Follow the same pattern as `lib/__mocks__/supabase.ts`.

---

## Screen

**File:** `app/(tabs)/friends.tsx` (new file — does not currently exist)

### Permission Denied State

Centred layout:

- Lock icon (`MaterialIcons "lock"`)
- Title: "Contacts Access Required"
- Body: "PaySplit needs access to your contacts to show which friends are already on the app."
- Primary button: "Allow Access" → calls `Linking.openSettings()`
- `useFocusEffect` calls `refetch()` when the screen regains focus (handles return from Settings)

### Loading State

Centred `ActivityIndicator` (primary green, `size="large"`).

### Loaded State

`SectionList` with two sections, `refreshControl` wired to `refetch`.

**Section 1 — "On PaySplit" (`matched`)**

Each row:

- Avatar circle: user's `avatarUrl` if set, else initials on `C.surfaceHL` background
- Name (bold)
- Balance chip (right-aligned):
  - Green: "You are owed {amount}"
  - Orange: "You owe {amount}"
  - Slate: "Settled up"
  - Slate: "No shared groups"
- Tapping a row opens a bottom sheet (implemented as a `Modal` with `animationType="slide"` and `transparent`, matching the existing pattern in `app/group/[id].tsx` settings sheet) with two actions:
  - **"Add to Group"** → navigates to `/invite-friend` with the matched user's `userId` and `name` as params; the existing invite screen shows all groups the user belongs to (no ownership restriction — consistent with current invite-friend behaviour)
  - **"View Balance"** → navigates to `app/group/balances.tsx` passing the shared group with the largest absolute balance (i.e. `max(abs(balance_cents))` across groups the two users share, derived from the `get_friend_balances` results); if multiple groups are tied or a simpler UX is needed, use the most recently created shared group. Disabled (greyed out, no `onPress`) if `balanceStatus === 'no_groups'`

Empty state for this section: "None of your contacts are on PaySplit yet."

**Section 2 — "Invite to PaySplit" (`unmatched`)**

Each row:

- Initials avatar on `C.surfaceHL` background
- Name
- "Invite" button → triggers `Share.share()` from `react-native` with:
  ```
  "Hey! I use PaySplit to split bills with friends. Join me: https://paysplit.app"
  ```
  URL uses `INVITE_WEB_LINK_BASE` from `lib/app-config.ts` (already exists); if it is an empty string, omit the URL from the share message

Sorted alphabetically. Capped at 50 entries initially; "Show more" `Pressable` at the bottom reveals the rest.

Empty state for this section: "All your contacts are already on PaySplit."

---

## Tab Navigation

**File:** `app/(tabs)/_layout.tsx`

Add Friends tab between Groups and Activity:

```
Groups | Friends | Activity | Account
```

- Tab icon: `MaterialIcons "people"`
- Tab label: "Friends"
- Screen name: `"friends"` (maps to `friends.tsx`)

---

## Error Handling

- RPC call failure: display inline error banner with "Retry" button that calls `refetch()`
- Contacts read failure after permission granted: treat same as permission denied (show permission denied UI)
- Empty `p_emails` and `p_phones` (user has contacts with no email/phone): skip RPC call, return all contacts as unmatched

---

## Testing

- Unit test `normalizePhone` independently (pure function — no mocks needed)
- Unit test `use-friends.ts`: mock `expo-contacts` (via `lib/__mocks__/expo-contacts.ts`) and Supabase RPCs; verify:
  - Permission denied path sets `permissionDenied: true`
  - RPC join correctly attaches balance to matched contacts
  - `unmatched` contains contacts with no RPC match
  - `refetch` re-runs permission check
- Manual test: permission denied flow → grant in Settings → return to screen → contacts load

---

## Out of Scope

- Storing contacts server-side
- Real-time updates when a contact joins the app
- Profile phone number editing UI (phone field added to DB but not surfaced in account screen in this iteration)
- International phone number normalization beyond E.164 best-effort (noted as known limitation)
