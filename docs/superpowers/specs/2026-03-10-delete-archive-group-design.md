# Design: Delete & Archive Group

**Date:** 2026-03-10

## Overview

Add the ability for group creators to manually archive or permanently delete a group, plus automatic archival of settled groups after 7 days of inactivity.

---

## User Stories

- As a group creator, I can archive a group so it disappears from my list without losing history.
- As a group creator, I can permanently delete a group (with a type-to-confirm safeguard).
- As a user, settled groups I belong to are automatically archived 7 days after all balances reach zero.
- As a non-creator group member, I cannot archive or delete the group.

---

## Architecture

### Entry Point

The existing settings icon (⚙) in `app/group/[id].tsx` is currently a non-functional placeholder. It becomes a tappable button that opens a settings bottom sheet — but only if the current user is the group creator (`group.created_by === session.user.id`).

### Flow: Manual Archive

1. Creator taps ⚙ → settings bottom sheet opens
2. Taps "Archive Group"
3. Supabase `UPDATE groups SET archived = true WHERE id = ?`
4. Navigate back to home (`router.replace('/')`)
5. Home screen no longer shows the group (filtered by `archived = false`)

### Flow: Manual Delete

1. Creator taps ⚙ → settings bottom sheet opens
2. Taps "Delete Group" (red/destructive styling)
3. Type-to-confirm modal opens
4. User types exact group name → Delete button enables (red)
5. Supabase `DELETE FROM groups WHERE id = ?`
6. Cascading deletes remove all `group_members`, `expenses`, `expense_splits`, `group_balances`
7. Navigate back to home

### Flow: Auto-Archive (Edge Function)

- New Supabase Edge Function: `auto-archive-settled-groups`
- Daily cron schedule via `supabase/config.toml`
- Archives groups where:
  - `archived = false`
  - No `group_balances` row has `balance != 0`
  - `updated_at < NOW() - INTERVAL '7 days'`

---

## UI Components

### Settings Bottom Sheet

Reuses the `Modal` + bottom sheet pattern from `app/(tabs)/account.tsx`.

Rows:
| Label | Icon | Style |
|---|---|---|
| Archive Group | archive icon | orange (`#f97316`) |
| Delete Group | trash icon | red/destructive (`#ff5252`) |

Only rendered/accessible when `currentUser.id === group.created_by`.

### Type-to-Confirm Delete Modal

- Warning: "This will permanently delete **[group name]** and all its expenses. This cannot be undone."
- `TextInput` with placeholder "Type group name to confirm"
- Delete button: disabled + grey until input matches group name exactly; then red + enabled
- Cancel: dismisses modal, returns to settings sheet

---

## Data Layer

### `hooks/use-groups.ts`

Add `.eq('archived', false)` filter to the groups query so archived groups are excluded from the home screen.

### Direct Supabase calls (in `app/group/[id].tsx`)

- Archive: `supabase.from('groups').update({ archived: true }).eq('id', groupId)`
- Delete: `supabase.from('groups').delete().eq('id', groupId)`

No new hook needed — mutations are one-off actions on a single screen.

---

## Database

### Migration

Add `UPDATE` and `DELETE` RLS policies on the `groups` table restricting these operations to the group creator:

```sql
-- Allow group creator to update (archive)
CREATE POLICY "Group creator can update group"
  ON groups FOR UPDATE
  USING (auth.uid() = created_by);

-- Allow group creator to delete group
CREATE POLICY "Group creator can delete group"
  ON groups FOR DELETE
  USING (auth.uid() = created_by);
```

No schema changes — `archived BOOLEAN DEFAULT FALSE` already exists.

---

## Edge Function: `auto-archive-settled-groups`

**File:** `supabase/functions/auto-archive-settled-groups/index.ts`

**Schedule:** Daily (configured in `supabase/config.toml`)

**Logic:**

```sql
UPDATE groups
SET archived = true
WHERE archived = false
  AND id NOT IN (
    SELECT group_id FROM group_balances WHERE balance != 0
  )
  AND updated_at < NOW() - INTERVAL '7 days'
```

Uses service role key (same pattern as `dispatch-push-notifications`).

---

## Files to Modify / Create

| File                                                                | Change                                                                  |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `app/group/[id].tsx`                                                | Make ⚙ tappable (creator only), add settings sheet + delete modal state |
| `hooks/use-groups.ts`                                               | Add `.eq('archived', false)` filter                                     |
| `supabase/migrations/<timestamp>_group_archive_delete_policies.sql` | RLS policies for UPDATE and DELETE                                      |
| `supabase/functions/auto-archive-settled-groups/index.ts`           | New edge function                                                       |
| `supabase/config.toml`                                              | Register cron schedule for edge function                                |

---

## Verification

1. **Archive:** As group creator, tap ⚙ → Archive → group disappears from home list. Check Supabase `groups` table: `archived = true`.
2. **Delete:** As group creator, tap ⚙ → Delete → type group name → confirm. Group and all related records removed from DB.
3. **Access control:** As non-creator member, ⚙ icon is absent or non-interactive.
4. **Auto-archive:** Manually set a group's `updated_at` to 8 days ago with all balances = 0, trigger the edge function, verify `archived = true`.
5. **Home filter:** Archived groups do not appear on home screen.
