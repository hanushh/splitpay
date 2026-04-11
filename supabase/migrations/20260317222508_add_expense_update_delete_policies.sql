-- supabase/migrations/20260317222508_add_expense_update_delete_policies.sql

-- Allow any group member to UPDATE an expense in their group
CREATE POLICY "Group members can update expenses"
  ON public.expenses FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members
      WHERE public.group_members.group_id = public.expenses.group_id
        AND public.group_members.user_id = auth.uid()
    )
  );

-- Allow any group member to DELETE an expense in their group
CREATE POLICY "Group members can delete expenses"
  ON public.expenses FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members
      WHERE public.group_members.group_id = public.expenses.group_id
        AND public.group_members.user_id = auth.uid()
    )
  );

-- Allow any group member to UPDATE expense_splits (future-proofing)
CREATE POLICY "Group members can update expense_splits"
  ON public.expense_splits FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      JOIN public.group_members gm ON gm.group_id = e.group_id
      WHERE e.id = public.expense_splits.expense_id
        AND gm.user_id = auth.uid()
    )
  );

-- Allow any group member to DELETE expense_splits (needed for edit: replace splits)
CREATE POLICY "Group members can delete expense_splits"
  ON public.expense_splits FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      JOIN public.group_members gm ON gm.group_id = e.group_id
      WHERE e.id = public.expense_splits.expense_id
        AND gm.user_id = auth.uid()
    )
  );
