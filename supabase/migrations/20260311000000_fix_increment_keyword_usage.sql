-- Add length validation to increment_keyword_usage to prevent garbage data
CREATE OR REPLACE FUNCTION public.increment_keyword_usage(
  p_keywords text[],
  p_category text
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  INSERT INTO public.category_keyword_mappings (keyword, category, usage_count)
  SELECT kw, p_category, 1
  FROM unnest(p_keywords) AS kw
  WHERE LENGTH(p_category) BETWEEN 1 AND 100
    AND LENGTH(kw) BETWEEN 1 AND 100
  ON CONFLICT (keyword, category)
  DO UPDATE SET usage_count = category_keyword_mappings.usage_count + 1;
$$;
