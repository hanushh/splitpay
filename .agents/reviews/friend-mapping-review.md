# Friend Mapping Stability Review

**Date:** 2026-03-17
**Branch:** `claude/review-friend-mapping-dGA7A`
**Scope:** `hooks/use-friends.ts`, `get_friend_balances()`, `get_group_friends()`, `match_contacts()`, `lib/phone.ts`

---

## Summary

The friend mapping pipeline has **three structural bugs** that produce inconsistent results across runs and across users, plus several secondary issues that reduce reliability.

---

## Critical Issues

### 1. `get_friend_balances` — GROUP BY defeats cross-group aggregation

**File:** `supabase/migrations/20260314120000_fix_balance_cross_product.sql` line 154

```sql
GROUP BY gm.display_name, gm.user_id, et.total, st.total
```

`et.total` and `st.total` are already unique per `group_members` row because `expense_totals` and `settled_totals` are aggregated by `member_id` (the per-group membership ID, not `user_id`). Including them in the GROUP BY means a user who is a member of two groups will **always produce two separate rows** — one per group — rather than one row with their combined cross-group balance.

The `MAX(gm.avatar_url)` aggregate is therefore also a no-op (it always operates on a single row), and the balance returned is per-group, not per-friend.

**Fix:** Pre-aggregate `expense_totals` and `settled_totals` by `user_id` before the final join, then GROUP BY only `gm.user_id`.

---

### 2. `get_friend_balances` — NULL `user_id` rows included in aggregation

**File:** `supabase/migrations/20260314120000_fix_balance_cross_product.sql` line 153

```sql
WHERE (gm.user_id IS NULL OR gm.user_id != p_user_id)
```

External contacts (invited but not yet registered) have `user_id = NULL`. The query includes them and groups them by `(display_name, user_id=NULL, ...)`. Any two external members named "Sarah" across different groups will have their balances merged into a single phantom row. The returned `user_id` is NULL, which is then silently dropped by the client at line 121 of `use-friends.ts`:

```typescript
if (row.user_id) balanceByUserId.set(...)
```

So external-contact balances are **always discarded** even when they exist.

**Fix:** Filter `WHERE gm.user_id IS NOT NULL AND gm.user_id != p_user_id`. Track external-member balances separately via `member_id` if needed.

---

### 3. Name-based deduplication of unmatched contacts

**File:** `hooks/use-friends.ts` lines 151–156

```typescript
const matchedProfileNames = new Set(
  matchedFriends.map((f) => f.name.toLowerCase().trim())
);
const finalUnmatched = contacts.filter(
  (c) => c.name && !matchedProfileNames.has(c.name.toLowerCase().trim())
);
```

Contacts are excluded from the unmatched list by string-comparing their name against matched friends' display names. This fails in two ways:

- **False positive match:** A contact named "John Smith" is hidden from the unmatched list because a *different* registered user also named "John Smith" was matched.
- **False negative match:** A registered friend whose app display name differs slightly from the contacts entry ("Rob" vs "Robert Taylor") won't be filtered out, so they appear in both matched and unmatched.

The matched list is already keyed by `userId`, so there is no ambiguity there. The unmatched filter simply has no stable identifier to use.

**Fix:** Track *which contact email/phone values* were actually matched by `match_contacts` (the RPC already uses those to find the user), and filter unmatched contacts by whether any of their emails or phones produced a match — not by name.

---

## High-Severity Issues

### 4. `HAVING balance != 0` removes settled friends

**File:** `supabase/migrations/20260314120000_fix_balance_cross_product.sql` line 155

```sql
HAVING COALESCE(et.total, 0) - COALESCE(st.total, 0) != 0
```

A friend who has been fully settled disappears entirely from the Friends tab. The client assigns `balanceStatus: 'no_groups'` (line 140 of `use-friends.ts`) for any friend not in the balance results — indistinguishable from a stranger. Users lose visibility into shared-group relationships once accounts are zeroed.

**Fix:** Remove the HAVING clause and return all friends with a balance column that can be zero. The `no_groups` vs `settled` distinction should be driven by whether the friend shares any group with the caller.

---

### 5. `match_contacts` still OR-matches on deprecated `phone_hash`

**File:** `supabase/migrations/20260316000001_add_plain_phone_to_profiles.sql` lines 24–26

```sql
OR (p.phone_hash IS NOT NULL AND p.phone_hash = ANY(p_phone_hashes))
```

The client always sends `p_phone_hashes: []` (empty array), so this branch never fires today. However, some profiles may still have a populated `phone_hash` but no `phone` value (e.g., created before the backfill migration `20260317000001`). Those users will not be matched by phone at all, even if the caller has their number in contacts.

**Fix:** Verify the backfill migration covered all existing profiles, then drop the `phone_hash` OR condition and the column itself to prevent confusion.

---

### 6. `get_group_friends` excludes external contacts

**File:** `supabase/migrations/20260316000000_add_get_group_friends.sql` line 19

```sql
AND gm.user_id IS NOT NULL
```

This function is used to surface group co-members who have no expense activity. By filtering out NULL `user_id` rows, invited-but-unregistered contacts are invisible in the Friends tab even when they are active members of a shared group.

---

## Medium-Severity Issues

### 7. Phone normalization is US-centric

**File:** `lib/phone.ts` lines 6–8

```typescript
if (digits.length === 10) return `${DEFAULT_COUNTRY_CODE}${digits}`;
```

Ten-digit numbers are unconditionally prefixed with the default country code (US `+1`). A UK number like `07911 123456` (11 digits starting with 0, not `1`) falls through to the `> 6` branch and is returned as `+07911123456` — not a valid E.164 number and will never match a correctly stored `+447911123456`.

---

## Issue Summary Table

| # | Severity | Location | Effect |
|---|----------|----------|--------|
| 1 | **Critical** | `get_friend_balances` GROUP BY | Cross-group balances not aggregated; user appears N times (once per group) |
| 2 | **Critical** | `get_friend_balances` WHERE | External-contact balances always discarded |
| 3 | **Critical** | `use-friends.ts` name dedup | Name collisions hide contacts or cause false matches |
| 4 | **High** | `get_friend_balances` HAVING | Settled friends disappear from list |
| 5 | **High** | `match_contacts` phone_hash | Users with only old phone_hash data are unmatchable |
| 6 | **High** | `get_group_friends` | Unregistered invitees invisible in Friends tab |
| 7 | **Medium** | `lib/phone.ts` | Non-US numbers normalised incorrectly |

---

## Recommended Fix Order

1. Rewrite `get_friend_balances` to aggregate by `user_id` at the CTE level and exclude NULL `user_id` rows.
2. Replace name-based unmatched-contact deduplication with email/phone-value-based tracking.
3. Remove the `HAVING balance != 0` filter; let the client distinguish `settled` vs `no_groups` using group membership data.
4. Audit backfill coverage of `phone_hash → phone` migration; drop the `phone_hash` OR branch from `match_contacts`.
5. Fix `lib/phone.ts` to handle non-US number formats (or reject ambiguous inputs rather than silently mangling them).
