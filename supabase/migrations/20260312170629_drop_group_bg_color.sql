-- Remove bg_color from groups. Icon and colour are now derived client-side from the group name.
ALTER TABLE public.groups DROP COLUMN IF EXISTS bg_color;
