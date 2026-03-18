-- Extend match_contacts to also return which identifier (email_hash or phone) caused the match.
-- This allows the client to map contacts to profiles by identifier, not name.
DROP FUNCTION IF EXISTS public.match_contacts(text[], text[], text[]);

CREATE OR REPLACE FUNCTION public.match_contacts(
  p_email_hashes  text[],
  p_phone_hashes  text[],
  p_phones        text[] DEFAULT '{}'
)
RETURNS TABLE (id uuid, name text, avatar_url text, matched_identifier text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT DISTINCT ON (p.id)
      p.id,
      p.name,
      p.avatar_url,
      CASE
        WHEN p.email_hash IS NOT NULL AND p.email_hash = ANY(p_email_hashes) THEN p.email_hash
        WHEN p.phone IS NOT NULL AND p.phone = ANY(p_phones) THEN p.phone
        WHEN p.phone_hash IS NOT NULL AND p.phone_hash = ANY(p_phone_hashes) THEN p.phone_hash
        ELSE NULL
      END AS matched_identifier
    FROM public.profiles p
    WHERE
      p.id <> auth.uid()
      AND (
        (p.email_hash IS NOT NULL AND p.email_hash = ANY(p_email_hashes))
        OR (p.phone_hash IS NOT NULL AND p.phone_hash = ANY(p_phone_hashes))
        OR (p.phone IS NOT NULL AND p.phone = ANY(p_phones))
      );
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_contacts(text[], text[], text[]) TO authenticated;
