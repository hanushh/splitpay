-- DROP the old 2-parameter overload of match_contacts.
-- Migration 20260316000001 used CREATE OR REPLACE with a new 3-parameter signature
-- (p_phones added with a default), which created a second overload instead of replacing
-- the original. Postgres cannot resolve which to call, causing ambiguity errors.
-- The 3-param version handles all cases since p_phones defaults to '{}'.
DROP FUNCTION IF EXISTS public.match_contacts(text[], text[]);
