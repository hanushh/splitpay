-- Adds updated_at column to groups table and a trigger to keep it current.
-- Required for the auto-archive-settled-groups cron job.

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Back-fill existing rows
UPDATE public.groups SET updated_at = created_at WHERE updated_at = NOW() AND created_at < NOW();

-- Trigger function to auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on groups table
DROP TRIGGER IF EXISTS groups_set_updated_at ON public.groups;
CREATE TRIGGER groups_set_updated_at
  BEFORE UPDATE ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
