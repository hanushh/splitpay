CREATE TABLE public.deletion_requests (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token      UUID        NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours')
);

-- Only accessible via service role in edge function — no RLS needed
ALTER TABLE public.deletion_requests DISABLE ROW LEVEL SECURITY;

-- Clean up expired tokens automatically
CREATE INDEX deletion_requests_expires_at_idx ON public.deletion_requests (expires_at);
