-- Create recurring_expenses table for scheduled/template expenses
CREATE TABLE recurring_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'USD',
  category TEXT NOT NULL DEFAULT 'other',
  paid_by_member_id UUID REFERENCES group_members(id) ON DELETE SET NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'yearly')),
  next_occurrence_date DATE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE recurring_expenses ENABLE ROW LEVEL SECURITY;

-- Only group members can view recurring expenses for their groups
CREATE POLICY "Group members can view recurring expenses"
  ON recurring_expenses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = recurring_expenses.group_id
        AND group_members.user_id = auth.uid()
    )
  );

-- Only group members can create recurring expenses
CREATE POLICY "Group members can create recurring expenses"
  ON recurring_expenses FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = recurring_expenses.group_id
        AND group_members.user_id = auth.uid()
    )
  );

-- Only group members can update recurring expenses
CREATE POLICY "Group members can update recurring expenses"
  ON recurring_expenses FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = recurring_expenses.group_id
        AND group_members.user_id = auth.uid()
    )
  );

-- Only group members can delete recurring expenses
CREATE POLICY "Group members can delete recurring expenses"
  ON recurring_expenses FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = recurring_expenses.group_id
        AND group_members.user_id = auth.uid()
    )
  );

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_recurring_expenses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER recurring_expenses_updated_at
  BEFORE UPDATE ON recurring_expenses
  FOR EACH ROW EXECUTE FUNCTION update_recurring_expenses_updated_at();
