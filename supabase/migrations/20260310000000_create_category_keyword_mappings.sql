-- Create shared keyword → category mapping table
CREATE TABLE IF NOT EXISTS public.category_keyword_mappings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword      text NOT NULL,
  category     text NOT NULL,
  usage_count  integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT category_keyword_mappings_unique UNIQUE (keyword, category)
);

-- Index for cache fetch (ORDER BY usage_count DESC LIMIT 3000)
CREATE INDEX IF NOT EXISTS idx_category_keyword_mappings_usage
  ON public.category_keyword_mappings (usage_count DESC);

-- RLS
ALTER TABLE public.category_keyword_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_all_mappings"
  ON public.category_keyword_mappings FOR SELECT
  USING (true);

CREATE POLICY "authenticated_insert"
  ON public.category_keyword_mappings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated_update"
  ON public.category_keyword_mappings FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Atomic server-side increment function (avoids client-side race conditions)
CREATE OR REPLACE FUNCTION public.increment_keyword_usage(
  p_keywords text[],
  p_category text
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  INSERT INTO public.category_keyword_mappings (keyword, category, usage_count)
  SELECT unnest(p_keywords), p_category, 1
  ON CONFLICT (keyword, category)
  DO UPDATE SET usage_count = category_keyword_mappings.usage_count + 1;
$$;
