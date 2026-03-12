# Friends Tab — Design Spec

**Date:** 2026-03-12
**Status:** Approved

---

## Overview

Add a "Friends" tab to the bottom navigator. The screen reads the user's device contacts, matches them against app users by email and phone number, and displays two sections: contacts already on PaySplit and contacts who haven't joined yet. Users can view shared balances and add on-app friends to groups, or invite off-app contacts via the native share sheet.

---

## Database

### 1. Add `phone` to `profiles`

```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;
```

- Nullable text column
- Stores E.164 normalized phone numbers (e.g. `+14155552671`)
- Populated when a user adds their phone number (future profile edit) or at signup if provided
- No uniqueness constraint (users may share a phone in edge cases)

### 2. New RPC: `match_contacts`

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

- `SECURITY DEFINER` to access `auth.users.email`
- Excludes the calling user from results
- Returns only `id`, `name`, `avatar_url` — no emails or phone numbers leaked back to client
- Single round trip regardless of contact list size

### Migrations

Two migration files (created via `supabase migration new`, pushed via `supabase db push`):

1. `add_phone_to_profiles` — ALTER TABLE
2. `add_match_contacts_rpc` — CREATE FUNCTION + GRANT

---

## Data Layer

### `hooks/use-friends.ts`

Manages the full pipeline. Returns:

```typescript
interface MatchedFriend {
  userId: string;
  name: string;
  avatarUrl: string | null;
  balanceCents: number;        // positive = owed to user, negative = user owes
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

1. Request contacts permission via `expo-contacts` (`requestPermissionsAsync`)
2. If denied → set `permissionDenied: true`, return early
3. Read all contacts (`getContactsAsync` with `Fields.Emails`, `Fields.PhoneNumbers`, `Fields.Name`)
4. Extract unique emails (lowercased) and unique phone numbers (normalized to E.164)
5. **Phone normalization:** strip all non-digit characters, if 10 digits prepend `+1` (US default), if 11 digits starting with `1` prepend `+`, otherwise prepend `+`. Store constant `DEFAULT_COUNTRY_CODE = '+1'` for easy configuration.
6. Call `match_contacts(p_emails, p_phones)` RPC
7. Call `get_friend_balances(p_user_id)` RPC (already exists)
8. Join: for each matched profile, find their balance from step 7; if no entry exists set `balanceStatus: 'no_groups'`
9. Build `unmatched`: contacts whose emails and phones share no overlap with matched user IDs (client-side set difference)
10. Sort `matched` by absolute balance descending (highest outstanding balance first); sort `unmatched` alphabetically by name

---

## Screen

**File:** `app/(tabs)/friends.tsx`

### Permission Denied State

Centred layout:
- Lock icon
- Title: "Contacts Access Required"
- Body: "PaySplit needs access to your contacts to show which friends are already on the app."
- Primary button: "Allow Access" → calls `Linking.openSettings()` if permanently denied, otherwise re-requests permission
- Uses `useFocusEffect` to re-check permission when user returns from Settings

### Loading State

Centred `ActivityIndicator` (primary green).

### Loaded State

`SectionList` with two sections:

**Section 1 — "On PaySplit" (`matched`)**

Each row:
- Avatar circle: user's `avatar_url` if set, else initials on `C.surfaceHL` background
- Name (bold)
- Balance chip (right-aligned):
  - Green: "You are owed {amount}"
  - Orange: "You owe {amount}"
  - Slate: "Settled up"
  - Slate: "No shared groups"
- Tapping a row opens a bottom sheet with two actions:
  - **"Add to Group"** → group picker sheet (list of groups user owns) → navigates to `/invite-friend` with pre-filled `groupId`
  - **"View Balance"** → navigates to existing friends balance screen (or group detail if single shared group)

Empty state for this section: "None of your contacts are on PaySplit yet."

**Section 2 — "Invite to PaySplit" (`unmatched`)**

Each row:
- Initials avatar on `C.surfaceHL` background
- Name
- "Invite" button → triggers `Share.share()` from `react-native` with message: "Hey! I'm using PaySplit to split bills. Join me: https://paysplit.app" (URL configurable via `lib/app-config.ts`)

Sorted alphabetically. Capped at 50 entries rendered initially with a "Show more" button to avoid overwhelming the list.

Empty state for this section: "All your contacts are already on PaySplit 🎉"

### Pull-to-refresh

`RefreshControl` on `SectionList` triggers `refetch()`.

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

- RPC errors: display inline error banner with retry button
- Contacts read failure: treated same as permission denied for UX simplicity
- Empty contact list: show both empty states gracefully

---

## Testing

- Unit test `use-friends.ts` hook: mock `expo-contacts` and Supabase RPCs; verify pipeline steps (normalization, join, sorting)
- Test phone normalization function independently (pure function, easy to unit test)
- Manual test: permission denied flow, permission granted with no matches, permission granted with matches

---

## Out of Scope

- Storing contacts server-side
- Real-time updates when a contact joins the app
- Profile phone number editing UI (phone field added to DB but not surfaced in account screen in this iteration)
