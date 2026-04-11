-- ── Add receipt_url to expenses ──────────────────────────────
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS receipt_url TEXT;

-- ── Storage bucket for receipts ───────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'receipts',
  'receipts',
  false,
  5242880, -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ── Storage RLS policies ──────────────────────────────────────
-- Upload: any authenticated user may upload to receipts/
CREATE POLICY "authenticated users can upload receipts"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'receipts');

-- Read: group members may read receipts belonging to their groups.
-- Path convention: receipts/<group_id>/<expense_id>.<ext>
-- We allow read if the user is a member of the group encoded in the path.
CREATE POLICY "group members can read receipts"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'receipts'
    AND public.is_group_member(
      (string_to_array(name, '/'))[1]::UUID,
      auth.uid()
    )
  );

-- Delete: only the uploader can delete (owner = auth.uid())
CREATE POLICY "uploaders can delete receipts"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'receipts' AND owner = auth.uid());
