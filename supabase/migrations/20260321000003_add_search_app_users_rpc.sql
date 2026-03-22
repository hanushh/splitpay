-- search_app_users: allows any authenticated user to find other app users
-- by name, phone, or email prefix/substring — bypassing RLS on profiles so
-- that newly-joined users (no shared groups yet) can still be discovered.
-- Only returns id / name / avatar_url — no sensitive fields exposed.

create or replace function public.search_app_users(p_query text)
returns table(
  user_id    uuid,
  name       text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    coalesce(p.name, split_part(u.email, '@', 1)) as name,
    p.avatar_url
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id <> auth.uid()
    and (
      p.name ilike '%' || p_query || '%'
      or u.email ilike '%' || p_query || '%'
      or p.phone like '%' || p_query || '%'
    )
  order by p.name asc nulls last
  limit 20;
$$;

revoke all on function public.search_app_users(text) from public;
grant execute on function public.search_app_users(text) to authenticated;
