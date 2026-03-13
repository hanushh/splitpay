CREATE INDEX IF NOT EXISTS idx_profiles_email_hash ON public.profiles (email_hash) WHERE email_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_phone_hash ON public.profiles (phone_hash) WHERE phone_hash IS NOT NULL;
