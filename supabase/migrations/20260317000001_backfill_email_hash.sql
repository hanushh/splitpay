-- Backfill email_hash for profiles where it is NULL.
-- Uses pgcrypto encode(digest(...)) to match the SHA-256 hex computed by the client.
UPDATE public.profiles p
SET email_hash = encode(
  extensions.digest(lower(trim(au.email)), 'sha256'),
  'hex'
)
FROM auth.users au
WHERE au.id = p.id
  AND p.email_hash IS NULL
  AND au.email IS NOT NULL;
