-- Lookup a user's email by their plain phone number.
-- Used at sign-in to allow logging in with phone + password.
-- Callable by anon so the user can look themselves up before authenticating.
CREATE OR REPLACE FUNCTION public.get_email_by_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  SELECT au.email INTO v_email
  FROM public.profiles p
  JOIN auth.users au ON au.id = p.id
  WHERE p.phone = p_phone
  LIMIT 1;
  RETURN v_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_email_by_phone(text) TO anon, authenticated;
