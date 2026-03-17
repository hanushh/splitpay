-- Add plain phone column to profiles for contact matching.
-- phone_hash is kept for backwards compatibility but phone is the source of truth going forward.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone TEXT;

-- Update match_contacts to also match on plain phone number.
CREATE OR REPLACE FUNCTION public.match_contacts(
  p_email_hashes  text[],
  p_phone_hashes  text[],
  p_phones        text[] DEFAULT '{}'
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
        OR (p.phone IS NOT NULL AND p.phone = ANY(p_phones))
      );
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_contacts(text[], text[], text[]) TO authenticated;
