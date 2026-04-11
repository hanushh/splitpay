# Delete & Archive Group Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow group creators to manually archive or permanently delete a group, with auto-archival of settled groups after 7 days.

**Architecture:** Settings bottom sheet launched from the existing placeholder ⚙ icon in the group detail screen; archive sets `archived=true`, delete requires typing the group name to confirm then hard-deletes (cascades handled by DB). Auto-archive runs daily via `pg_cron` SQL migration. `useGroups` is updated to filter out archived groups.

**Tech Stack:** React Native Modal, Supabase Postgres RLS, pg_cron extension, TypeScript strict mode, Jest

---

## File Map

| File                                                                   | Action | Responsibility                                                                  |
| ---------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `supabase/migrations/20260310120000_group_archive_delete_policies.sql` | Create | RLS UPDATE + DELETE policies; pg_cron auto-archive                              |
| `hooks/use-groups.ts`                                                  | Modify | Filter `archived = false` from query                                            |
| `__tests__/hooks/use-groups.test.tsx`                                  | Modify | Update mock chain; add archived-filter test                                     |
| `app/group/[id].tsx`                                                   | Modify | Add `created_by` to query; settings sheet; archive flow; type-to-confirm delete |

---

## Chunk 1: Database Migration

### Task 1: RLS policies + pg_cron auto-archive migration

**Files:**

- Create: `supabase/migrations/20260310120000_group_archive_delete_policies.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Adds UPDATE (archive) and DELETE policies for group creators.
-- Also schedules daily auto-archive of settled groups via pg_cron.

-- 1. Allow group creator to update (archive) their group
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'groups'
      and policyname = 'groups_update_creator'
  ) then
    create policy groups_update_creator
      on public.groups
      for update
      to authenticated
      using (created_by = auth.uid())
      with check (created_by = auth.uid());
  end if;
end $$;

-- 2. Allow group creator to delete their group
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'groups'
      and policyname = 'groups_delete_creator'
  ) then
    create policy groups_delete_creator
      on public.groups
      for delete
      to authenticated
      using (created_by = auth.uid());
  end if;
end $$;

-- 3. Enable pg_cron and schedule daily auto-archive of settled groups
create extension if not exists pg_cron;

select cron.schedule(
  'auto-archive-settled-groups',
  '0 2 * * *',
  $$
    UPDATE public.groups
    SET archived = true
    WHERE archived = false
      AND id NOT IN (
        SELECT group_id FROM public.group_balances WHERE balance_cents != 0
      )
      AND updated_at < NOW() - INTERVAL '7 days'
  $$
);
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use `mcp__claude_ai_Supabase__apply_migration` with the SQL above.

- [ ] **Step 3: Verify policies exist**

Run via Supabase SQL editor or MCP `execute_sql`:

```sql
SELECT policyname, cmd FROM pg_policies
WHERE tablename = 'groups'
ORDER BY policyname;
```

Expected: rows for `groups_update_creator` and `groups_delete_creator`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260310120000_group_archive_delete_policies.sql
git commit -m "feat: add RLS policies for group archive/delete + pg_cron auto-archive"
```

---

## Chunk 2: useGroups Hook — Filter Archived Groups

### Task 2: Add `archived = false` filter + update tests

**Files:**

- Modify: `hooks/use-groups.ts:40-48`
- Modify: `__tests__/hooks/use-groups.test.tsx`

- [ ] **Step 1: Write the failing test for archived filter**

In `__tests__/hooks/use-groups.test.tsx`, add this test inside the `describe('useGroups')` block:

```typescript
it('excludes archived groups from results', async () => {
  const rowsWithArchived = [
    {
      id: 'g1',
      name: 'Active Group',
      icon_name: 'group',
      bg_color: '#1a3324',
      archived: false,
      created_at: '2026-01-01T00:00:00Z',
      group_balances: [{ balance_cents: 1000 }],
      group_members: [{ user_id: 'user-123' }],
    },
    {
      id: 'g2',
      name: 'Archived Group',
      icon_name: 'group',
      bg_color: '#1a3324',
      archived: true,
      created_at: '2026-01-02T00:00:00Z',
      group_balances: [{ balance_cents: 0 }],
      group_members: [{ user_id: 'user-123' }],
    },
  ];
  (supabase.from as jest.Mock).mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({ data: rowsWithArchived, error: null }),
  });
  const { result } = renderHook(() => useGroups());
  await act(async () => {});
  // The hook should only return non-archived groups
  expect(result.current.groups).toHaveLength(1);
  expect(result.current.groups[0].name).toBe('Active Group');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="use-groups" --verbose
```

Expected: FAIL — "Expected: 1, Received: 2" (hook returns both groups since filter not implemented yet)

- [ ] **Step 3: Update existing mocks to include `eq` in the chain**

In `__tests__/hooks/use-groups.test.tsx`, every `mockReturnValue` block that defines a custom chain needs `eq: jest.fn().mockReturnThis()` added. Replace all occurrences of:

```typescript
(supabase.from as jest.Mock).mockReturnValue({
  select: jest.fn().mockReturnThis(),
  order: jest.fn().mockResolvedValue({
```

with:

```typescript
(supabase.from as jest.Mock).mockReturnValue({
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  order: jest.fn().mockResolvedValue({
```

There are 5 such overrides in the file — apply to all of them.

Also update the `beforeEach` mock at the top of the describe block:

```typescript
beforeEach(() => {
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: null });
  (supabase.from as jest.Mock).mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({ data: mockGroupRows, error: null }),
  });
});
```

- [ ] **Step 4: Add `.eq('archived', false)` filter to the hook**

In `hooks/use-groups.ts`, update the query chain (lines 40–48):

```typescript
const { data: groupRows, error: groupsErr } = await supabase
  .from('groups')
  .select(
    `
    id, name, description, image_url, bg_color, icon_name, archived,
    group_balances!left ( balance_cents ),
    group_members!inner ( id, display_name, avatar_url, user_id )
  `,
  )
  .eq('archived', false)
  .order('created_at', { ascending: true });
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="use-groups" --verbose
```

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add hooks/use-groups.ts __tests__/hooks/use-groups.test.tsx
git commit -m "feat: filter archived groups from useGroups hook"
```

---

## Chunk 3: Group Detail Screen — Settings Sheet + Archive

### Task 3: Add `created_by` to group query + settings bottom sheet + archive flow

**Files:**

- Modify: `app/group/[id].tsx`

- [ ] **Step 1: Add `created_by` to `GroupDetail` interface and fetch query**

In `app/group/[id].tsx`:

Update the `GroupDetail` interface (line 42):

```typescript
interface GroupDetail {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  bg_color: string;
  balance_cents: number;
  created_by: string;
}
```

Update the select string in `fetchGroup` (line 87):

```typescript
supabase.from('groups').select('id, name, description, image_url, bg_color, created_by').eq('id', id).single(),
```

- [ ] **Step 2: Add `Modal` and `TextInput` to imports**

Update the React Native import (line 4–12):

```typescript
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
```

- [ ] **Step 3: Add state variables for settings sheet and delete modal**

Inside `GroupDetailScreen`, after existing state declarations (after line 82):

```typescript
const [showSettings, setShowSettings] = useState(false);
const [showDeleteModal, setShowDeleteModal] = useState(false);
const [deleteInput, setDeleteInput] = useState('');
const [actionLoading, setActionLoading] = useState(false);
const [actionError, setActionError] = useState<string | null>(null);
```

Also add a derived constant after the `grouped` constant (after line 144):

```typescript
const isCreator = user?.id === group.created_by;
```

- [ ] **Step 4: Make the settings icon interactive for creators**

Replace the placeholder settings `Pressable` (lines 154–156):

```typescript
<Pressable
  style={s.backBtn}
  onPress={isCreator ? () => setShowSettings(true) : undefined}
  testID="settings-button"
>
  <MaterialIcons
    name="settings"
    size={24}
    color={isCreator ? C.white : C.slate500}
  />
</Pressable>
```

- [ ] **Step 5: Implement the archive handler**

Add this function inside `GroupDetailScreen`, before the `return` statement:

```typescript
const handleArchive = async () => {
  if (!group) return;
  setActionLoading(true);
  setActionError(null);
  const { error } = await supabase
    .from('groups')
    .update({ archived: true })
    .eq('id', group.id);
  setActionLoading(false);
  if (error) {
    setActionError(error.message);
    return;
  }
  setShowSettings(false);
  router.replace('/');
};
```

- [ ] **Step 6: Add the settings bottom sheet Modal**

Add this JSX just before the closing `</View>` of the main container (before line 271):

```tsx
{
  /* Settings bottom sheet */
}
<Modal
  visible={showSettings}
  transparent
  animationType="slide"
  onRequestClose={() => setShowSettings(false)}
>
  <Pressable style={s.modalOverlay} onPress={() => setShowSettings(false)} />
  <View style={s.bottomSheet}>
    <View style={s.sheetHandle} />
    <Text style={s.sheetTitle}>Group Settings</Text>

    {actionError ? <Text style={s.errorText}>{actionError}</Text> : null}

    <Pressable
      style={({ pressed }) => [s.sheetRow, pressed && { opacity: 0.7 }]}
      onPress={handleArchive}
      disabled={actionLoading}
    >
      <View
        style={[s.sheetIconWrap, { backgroundColor: 'rgba(249,115,22,0.12)' }]}
      >
        <MaterialIcons name="inventory" size={20} color={C.orange} />
      </View>
      <Text style={s.sheetRowText}>Archive Group</Text>
    </Pressable>

    <Pressable
      style={({ pressed }) => [s.sheetRow, pressed && { opacity: 0.7 }]}
      onPress={() => {
        setShowSettings(false);
        setShowDeleteModal(true);
      }}
      disabled={actionLoading}
    >
      <View
        style={[s.sheetIconWrap, { backgroundColor: 'rgba(255,82,82,0.12)' }]}
      >
        <MaterialIcons name="delete-forever" size={20} color="#ff5252" />
      </View>
      <Text style={[s.sheetRowText, { color: '#ff5252' }]}>Delete Group</Text>
    </Pressable>
  </View>
</Modal>;
```

- [ ] **Step 7: Add new styles for the bottom sheet**

Append to `StyleSheet.create(...)` at the bottom of the file:

```typescript
modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
bottomSheet: {
  backgroundColor: '#1a3324',
  borderTopLeftRadius: 20,
  borderTopRightRadius: 20,
  paddingBottom: 36,
  paddingHorizontal: 20,
  paddingTop: 12,
},
sheetHandle: {
  width: 36,
  height: 4,
  borderRadius: 2,
  backgroundColor: '#244732',
  alignSelf: 'center',
  marginBottom: 16,
},
sheetTitle: { color: '#ffffff', fontWeight: '700', fontSize: 17, marginBottom: 20 },
sheetRow: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 14,
  paddingVertical: 14,
  borderBottomWidth: 1,
  borderBottomColor: '#244732',
},
sheetIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
sheetRowText: { color: '#ffffff', fontWeight: '600', fontSize: 15 },
errorText: { color: '#ff5252', fontSize: 13, marginBottom: 8 },
```

- [ ] **Step 8: Run lint and typecheck**

```bash
npm run lint && npm run typecheck
```

Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add app/group/\[id\].tsx
git commit -m "feat: add settings sheet with archive action to group detail"
```

---

## Chunk 4: Type-to-Confirm Delete Modal

### Task 4: Delete handler + type-to-confirm modal UI

**Files:**

- Modify: `app/group/[id].tsx`

- [ ] **Step 1: Implement the delete handler**

Add this function inside `GroupDetailScreen`, after `handleArchive`:

```typescript
const handleDelete = async () => {
  if (!group || deleteInput !== group.name) return;
  setActionLoading(true);
  setActionError(null);
  const { error } = await supabase.from('groups').delete().eq('id', group.id);
  setActionLoading(false);
  if (error) {
    setActionError(error.message);
    return;
  }
  setShowDeleteModal(false);
  router.replace('/');
};
```

- [ ] **Step 2: Add the type-to-confirm delete Modal**

Add this JSX after the settings bottom sheet Modal (still inside the main container `</View>`):

```tsx
{
  /* Type-to-confirm delete modal */
}
<Modal
  visible={showDeleteModal}
  transparent
  animationType="fade"
  onRequestClose={() => {
    setShowDeleteModal(false);
    setDeleteInput('');
    setActionError(null);
  }}
>
  <View style={s.deleteOverlay}>
    <View style={s.deleteCard}>
      <View
        style={[
          s.sheetIconWrap,
          {
            backgroundColor: 'rgba(255,82,82,0.12)',
            alignSelf: 'center',
            marginBottom: 16,
          },
        ]}
      >
        <MaterialIcons name="delete-forever" size={28} color="#ff5252" />
      </View>
      <Text style={s.deleteTitle}>Delete Group</Text>
      <Text style={s.deleteWarning}>
        This will permanently delete{' '}
        <Text style={{ fontWeight: '700', color: '#ffffff' }}>
          {group?.name}
        </Text>{' '}
        and all its expenses. This cannot be undone.
      </Text>
      <Text style={s.deleteLabel}>
        Type{' '}
        <Text style={{ fontWeight: '700', color: '#ffffff' }}>
          {group?.name}
        </Text>{' '}
        to confirm
      </Text>
      <TextInput
        style={s.deleteInput}
        value={deleteInput}
        onChangeText={setDeleteInput}
        placeholder={group?.name}
        placeholderTextColor="#64748b"
        autoCapitalize="none"
        autoCorrect={false}
        testID="delete-confirm-input"
      />
      {actionError ? <Text style={s.errorText}>{actionError}</Text> : null}
      <Pressable
        style={({ pressed }) => [
          s.deleteConfirmBtn,
          deleteInput !== group?.name && s.deleteConfirmBtnDisabled,
          pressed && deleteInput === group?.name && { opacity: 0.8 },
        ]}
        onPress={handleDelete}
        disabled={deleteInput !== group?.name || actionLoading}
        testID="delete-confirm-button"
      >
        <Text style={s.deleteConfirmBtnText}>
          {actionLoading ? 'Deleting…' : 'Delete Group'}
        </Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [
          s.deleteCancelBtn,
          pressed && { opacity: 0.7 },
        ]}
        onPress={() => {
          setShowDeleteModal(false);
          setDeleteInput('');
          setActionError(null);
        }}
      >
        <Text style={s.deleteCancelBtnText}>Cancel</Text>
      </Pressable>
    </View>
  </View>
</Modal>;
```

- [ ] **Step 3: Add delete modal styles**

Append to `StyleSheet.create(...)`:

```typescript
deleteOverlay: {
  flex: 1,
  backgroundColor: 'rgba(0,0,0,0.7)',
  justifyContent: 'center',
  paddingHorizontal: 24,
},
deleteCard: {
  backgroundColor: '#1a3324',
  borderRadius: 20,
  padding: 24,
},
deleteTitle: { color: '#ffffff', fontWeight: '700', fontSize: 20, textAlign: 'center', marginBottom: 12 },
deleteWarning: { color: '#94a3b8', fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 20 },
deleteLabel: { color: '#94a3b8', fontSize: 13, marginBottom: 8 },
deleteInput: {
  backgroundColor: '#112117',
  borderWidth: 1,
  borderColor: '#244732',
  borderRadius: 12,
  paddingHorizontal: 14,
  paddingVertical: 12,
  color: '#ffffff',
  fontSize: 15,
  marginBottom: 16,
},
deleteConfirmBtn: {
  backgroundColor: '#ff5252',
  borderRadius: 12,
  height: 48,
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: 10,
},
deleteConfirmBtnDisabled: { backgroundColor: '#244732' },
deleteConfirmBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 15 },
deleteCancelBtn: {
  height: 48,
  alignItems: 'center',
  justifyContent: 'center',
},
deleteCancelBtnText: { color: '#94a3b8', fontWeight: '600', fontSize: 15 },
```

- [ ] **Step 4: Run lint and typecheck**

```bash
npm run lint && npm run typecheck
```

Expected: No errors

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add app/group/\[id\].tsx
git commit -m "feat: add type-to-confirm delete modal to group detail"
```

---

## Verification

1. **Archive flow:** As group creator, open a group → tap ⚙ → tap "Archive Group" → navigate back to home. Group no longer appears in the list. Verify in Supabase: `SELECT id, name, archived FROM groups WHERE name = '<group>';` — `archived = true`.

2. **Delete flow:** As group creator, open a group → tap ⚙ → tap "Delete Group" → type a wrong name → confirm button stays disabled. Type exact group name → button turns red → tap Delete. Navigate back to home; group is gone. Verify in Supabase: `SELECT * FROM groups WHERE name = '<group>';` — 0 rows.

3. **Non-creator:** As a non-creator member, open a group → ⚙ icon is grey and non-interactive (no bottom sheet opens).

4. **Auto-archive test (manual):** In Supabase SQL editor:

   ```sql
   -- Temporarily backdate a settled group to simulate 7+ days
   UPDATE groups SET updated_at = NOW() - INTERVAL '8 days'
   WHERE id = '<a settled group id>';

   -- Manually run the auto-archive logic
   UPDATE public.groups
   SET archived = true
   WHERE archived = false
     AND id NOT IN (SELECT group_id FROM public.group_balances WHERE balance_cents != 0)
     AND updated_at < NOW() - INTERVAL '7 days';

   -- Verify
   SELECT id, name, archived FROM groups WHERE id = '<group id>';
   ```

   Expected: `archived = true`.

5. **Home screen:** Archived groups do not appear in the groups list.
