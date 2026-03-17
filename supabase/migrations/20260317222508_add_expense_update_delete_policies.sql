-- supabase/migrations/20260317222508_add_expense_update_delete_policies.sql

-- Allow any group member to UPDATE an expense in their group
CREATE POLICY "Group members can update expenses"
  ON expenses FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = expenses.group_id
        AND group_members.user_id = auth.uid()
    )
  );

-- Allow any group member to DELETE an expense in their group
CREATE POLICY "Group members can delete expenses"
  ON expenses FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = expenses.group_id
        AND group_members.user_id = auth.uid()
    )
  );

-- Allow any group member to UPDATE expense_splits (future-proofing)
CREATE POLICY "Group members can update expense_splits"
  ON expense_splits FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM expenses e
      JOIN group_members gm ON gm.group_id = e.group_id
      WHERE e.id = expense_splits.expense_id
        AND gm.user_id = auth.uid()
    )
  );

-- Allow any group member to DELETE expense_splits (needed for edit: replace splits)
CREATE POLICY "Group members can delete expense_splits"
  ON expense_splits FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM expenses e
      JOIN group_members gm ON gm.group_id = e.group_id
      WHERE e.id = expense_splits.expense_id
        AND gm.user_id = auth.uid()
    )
  );
