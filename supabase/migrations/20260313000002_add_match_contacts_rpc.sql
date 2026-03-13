CREATE OR REPLACE FUNCTION public.match_contacts(
  p_email_hashes  text[],
  p_phone_hashes  text[]
)
RETURNS TABLE (id uuid, name text, avatar_url text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT p.id, p.name, p.avatar_url
    FROM public.profiles p
    WHERE
      p.id <> auth.uid()
      AND (
        (p.email_hash IS NOT NULL AND p.email_hash = ANY(p_email_hashes))
        OR (p.phone_hash IS NOT NULL AND p.phone_hash = ANY(p_phone_hashes))
      );
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_contacts(text[], text[]) TO authenticated;
