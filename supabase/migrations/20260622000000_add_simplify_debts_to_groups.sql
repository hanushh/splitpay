-- Add a per-group "simplify debts" preference. When TRUE (the default), the
-- Settle Up screen shows the minimized cross-person settlement plan (the fewest
-- payments that settle the whole group). When FALSE, it shows each member's
-- actual per-person balance instead.
--
-- Only the group creator can change it — the existing `groups_update_creator`
-- RLS policy (20260310120000_group_archive_delete_policies.sql) already gates
-- UPDATEs on public.groups, so no new policy is required.

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS simplify_debts BOOLEAN NOT NULL DEFAULT TRUE;
