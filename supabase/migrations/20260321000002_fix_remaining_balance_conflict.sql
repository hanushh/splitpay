-- Fix remaining functions that still use ON CONFLICT (group_id, user_id) on
-- group_balances, which now has a 3-column PK (group_id, user_id, currency_code).
--
-- Affected:
--   1. create_expense_with_splits (7-param legacy overload)
--   2. initialize_demo_data
--   3. redeem_invitation

-- ─── 1. create_expense_with_splits (7-param legacy) ─────────────────────────

create or replace function public.create_expense_with_splits(
  p_group_id         uuid,
  p_description      text,
  p_amount_cents     integer,
  p_paid_by_member_id uuid,
  p_category         text,
  p_receipt_url      text,
  p_split_member_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $_$
declare
  v_expense_id    uuid;
  v_member_count  integer;
  v_per_person    integer;
  v_remainder     integer;
  v_member_id     uuid;
  v_idx           integer;
  v_split_amount  integer;
  v_user_id       uuid;
  v_payer_user_id uuid;
  v_payer_split   integer := 0;
  v_group_name    text;
  v_actor_name    text;
  v_notif_title   text;
  v_notif_body    text;
begin
  if not public.is_group_member(p_group_id, auth.uid()) then
    raise exception 'Not a member of this group';
  end if;

  insert into public.expenses (
    group_id, description, amount_cents, paid_by_member_id, category, receipt_url
  ) values (
    p_group_id, p_description, p_amount_cents, p_paid_by_member_id, p_category, p_receipt_url
  ) returning id into v_expense_id;

  v_member_count := array_length(p_split_member_ids, 1);
  if v_member_count is null or v_member_count = 0 then
    raise exception 'At least one split member is required';
  end if;
  v_per_person := p_amount_cents / v_member_count;
  v_remainder  := p_amount_cents - (v_per_person * v_member_count);

  select user_id into v_payer_user_id
  from public.group_members where id = p_paid_by_member_id;

  select coalesce(name, 'a group') into v_group_name
  from public.groups where id = p_group_id;

  select coalesce(gm.display_name, p.name, split_part(u.email, '@', 1), 'Someone')
  into v_actor_name
  from public.group_members gm
  left join auth.users u on u.id = gm.user_id
  left join public.profiles p on p.id = gm.user_id
  where gm.id = p_paid_by_member_id;

  for v_idx in 1 .. v_member_count loop
    v_member_id    := p_split_member_ids[v_idx];
    v_split_amount := case when v_idx = v_member_count
                          then v_per_person + v_remainder
                          else v_per_person end;

    insert into public.expense_splits (expense_id, member_id, amount_cents)
    values (v_expense_id, v_member_id, v_split_amount);

    if v_member_id = p_paid_by_member_id then
      v_payer_split := v_split_amount;
    else
      select user_id into v_user_id from public.group_members where id = v_member_id;
      if v_user_id is not null then
        insert into public.group_balances (group_id, user_id, currency_code, balance_cents)
        values (p_group_id, v_user_id, 'INR', -v_split_amount)
        on conflict (group_id, user_id, currency_code) do update
          set balance_cents = public.group_balances.balance_cents - v_split_amount;
      end if;
    end if;
  end loop;

  if v_payer_user_id is not null then
    insert into public.group_balances (group_id, user_id, currency_code, balance_cents)
    values (p_group_id, v_payer_user_id, 'INR', p_amount_cents - v_payer_split)
    on conflict (group_id, user_id, currency_code) do update
      set balance_cents = public.group_balances.balance_cents + (p_amount_cents - v_payer_split);
  end if;

  for v_idx in 1 .. v_member_count loop
    v_member_id := p_split_member_ids[v_idx];
    select user_id into v_user_id from public.group_members where id = v_member_id;
    continue when v_user_id is null or v_user_id = auth.uid();

    v_split_amount := case when v_idx = v_member_count
                          then v_per_person + v_remainder
                          else v_per_person end;

    v_notif_title := format('New expense in %s', v_group_name);

    if v_member_id = p_paid_by_member_id then
      v_notif_body := format(
        '%s added "%s" ($%.2f) — you paid.',
        v_actor_name, p_description, p_amount_cents / 100.0
      );
    else
      v_notif_body := format(
        '%s paid $%.2f for "%s" — you owe $%.2f.',
        v_actor_name, p_amount_cents / 100.0, p_description, v_split_amount / 100.0
      );
    end if;

    insert into public.user_notifications (
      user_id, actor_user_id, group_id, type, title, body, metadata
    ) values (
      v_user_id,
      auth.uid(),
      p_group_id,
      'expense_added',
      v_notif_title,
      v_notif_body,
      jsonb_build_object(
        'expense_id',   v_expense_id,
        'group_id',     p_group_id,
        'group_name',   v_group_name,
        'amount_cents', p_amount_cents
      )
    );
  end loop;

  return v_expense_id;
end;
$_$;

-- ─── 2. initialize_demo_data ─────────────────────────────────────────────────

create or replace function public.initialize_demo_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g1_id uuid; g2_id uuid; g3_id uuid; g4_id uuid;
  mu_apt uuid; mu_japan uuid; mu_dinner uuid;
  sarah_apt uuid; sarah_japan uuid; mike_japan uuid;
  alex_dinner uuid; mike_dinner uuid; sarah_dinner uuid;
  e_id uuid;
begin
  select id into g1_id from groups where name = 'Apartment 4B'   limit 1;
  select id into g2_id from groups where name = 'Japan Trip 🇯🇵' limit 1;
  select id into g3_id from groups where name = 'Weekly Dinner'   limit 1;
  select id into g4_id from groups where name = 'Tahoe Ski Trip'  limit 1;

  insert into group_members (group_id, user_id) values
    (g1_id, p_user_id),(g2_id, p_user_id),(g3_id, p_user_id),(g4_id, p_user_id)
  on conflict do nothing;

  select id into mu_apt    from group_members where group_id = g1_id and user_id = p_user_id limit 1;
  select id into mu_japan  from group_members where group_id = g2_id and user_id = p_user_id limit 1;
  select id into mu_dinner from group_members where group_id = g3_id and user_id = p_user_id limit 1;

  -- Demo balances — use 3-column PK
  insert into group_balances (group_id, user_id, currency_code, balance_cents) values
    (g1_id, p_user_id, 'INR',  4500),
    (g2_id, p_user_id, 'INR',  0),
    (g3_id, p_user_id, 'INR', -2250),
    (g4_id, p_user_id, 'INR',  0)
  on conflict (group_id, user_id, currency_code) do nothing;

  if exists (select 1 from expenses where paid_by_member_id = mu_apt) then return; end if;

  -- Apartment 4B members
  if not exists (select 1 from group_members where group_id = g1_id and display_name = 'Sarah') then
    insert into group_members (group_id, display_name, avatar_url)
    values (g1_id, 'Sarah', 'https://i.pravatar.cc/48?img=5') returning id into sarah_apt;
  else
    select id into sarah_apt from group_members where group_id = g1_id and display_name = 'Sarah' limit 1;
  end if;

  insert into expenses (group_id, description, amount_cents, paid_by_member_id, category, created_at)
  values (g1_id, 'Groceries & Utilities', 9000, mu_apt, 'store', now() - interval '5 days')
  returning id into e_id;
  insert into expense_splits (expense_id, member_id, amount_cents) values
    (e_id, mu_apt, 4500),(e_id, sarah_apt, 4500);

  insert into expenses (group_id, description, amount_cents, paid_by_member_id, category, created_at)
  values (g1_id, 'Monthly Rent', 150000, sarah_apt, 'other', now() - interval '10 days')
  returning id into e_id;
  insert into expense_splits (expense_id, member_id, amount_cents) values
    (e_id, mu_apt, 75000),(e_id, sarah_apt, 75000);

  -- Japan Trip members
  if not exists (select 1 from group_members where group_id = g2_id and display_name = 'Sarah') then
    insert into group_members (group_id, display_name, avatar_url)
    values (g2_id, 'Sarah', 'https://i.pravatar.cc/48?img=5') returning id into sarah_japan;
  else
    select id into sarah_japan from group_members where group_id = g2_id and display_name = 'Sarah' limit 1;
  end if;
  if not exists (select 1 from group_members where group_id = g2_id and display_name = 'Mike') then
    insert into group_members (group_id, display_name, avatar_url)
    values (g2_id, 'Mike', 'https://i.pravatar.cc/48?img=3') returning id into mike_japan;
  else
    select id into mike_japan from group_members where group_id = g2_id and display_name = 'Mike' limit 1;
  end if;

  insert into expenses (group_id, description, amount_cents, paid_by_member_id, category, created_at)
  values (g2_id, 'Sushi Dinner at Ginza', 12000, mu_japan, 'restaurant', now() - interval '2 days')
  returning id into e_id;
  insert into expense_splits (expense_id, member_id, amount_cents) values
    (e_id, mu_japan, 4000),(e_id, sarah_japan, 4000),(e_id, mike_japan, 4000);

  insert into expenses (group_id, description, amount_cents, paid_by_member_id, category, created_at)
  values (g2_id, 'Hotel Stay in Kyoto', 30000, sarah_japan, 'hotel', now() - interval '3 days')
  returning id into e_id;
  insert into expense_splits (expense_id, member_id, amount_cents) values
    (e_id, mu_japan, 10000),(e_id, sarah_japan, 10000),(e_id, mike_japan, 10000);

  insert into expenses (group_id, description, amount_cents, paid_by_member_id, category, created_at)
  values (g2_id, 'Shinkansen Tickets', 24000, mike_japan, 'train', now() - interval '10 days')
  returning id into e_id;
  insert into expense_splits (expense_id, member_id, amount_cents) values
    (e_id, mu_japan, 8000),(e_id, sarah_japan, 8000),(e_id, mike_japan, 8000);

  insert into expenses (group_id, description, amount_cents, paid_by_member_id, category, created_at)
  values (g2_id, '7-Eleven Snacks', 4500, mu_japan, 'store', now() - interval '15 days')
  returning id into e_id;
  insert into expense_splits (expense_id, member_id, amount_cents) values
    (e_id, mu_japan, 1500),(e_id, sarah_japan, 1500),(e_id, mike_japan, 1500);

  -- Weekly Dinner members
  if not exists (select 1 from group_members where group_id = g3_id and display_name = 'Alex') then
    insert into group_members (group_id, display_name, avatar_url)
    values (g3_id, 'Alex', 'https://i.pravatar.cc/48?img=4') returning id into alex_dinner;
  else
    select id into alex_dinner from group_members where group_id = g3_id and display_name = 'Alex' limit 1;
  end if;
  if not exists (select 1 from group_members where group_id = g3_id and display_name = 'Mike') then
    insert into group_members (group_id, display_name, avatar_url)
    values (g3_id, 'Mike', 'https://i.pravatar.cc/48?img=3') returning id into mike_dinner;
  else
    select id into mike_dinner from group_members where group_id = g3_id and display_name = 'Mike' limit 1;
  end if;
  if not exists (select 1 from group_members where group_id = g3_id and display_name = 'Sarah') then
    insert into group_members (group_id, display_name, avatar_url)
    values (g3_id, 'Sarah', 'https://i.pravatar.cc/48?img=5') returning id into sarah_dinner;
  else
    select id into sarah_dinner from group_members where group_id = g3_id and display_name = 'Sarah' limit 1;
  end if;

  insert into expenses (group_id, description, amount_cents, paid_by_member_id, category, created_at)
  values (g3_id, 'Weekly Dinner - Thai', 9000, alex_dinner, 'restaurant', now() - interval '8 days')
  returning id into e_id;
  insert into expense_splits (expense_id, member_id, amount_cents) values
    (e_id, mu_dinner, 2250),(e_id, alex_dinner, 2250),(e_id, mike_dinner, 2250),(e_id, sarah_dinner, 2250);

  insert into expenses (group_id, description, amount_cents, paid_by_member_id, category, created_at)
  values (g3_id, 'Weekly Dinner - Italian', 8000, mu_dinner, 'restaurant', now() - interval '15 days')
  returning id into e_id;
  insert into expense_splits (expense_id, member_id, amount_cents) values
    (e_id, mu_dinner, 2000),(e_id, alex_dinner, 2000),(e_id, mike_dinner, 2000),(e_id, sarah_dinner, 2000);
end;
$$;

-- ─── 3. redeem_invitation ────────────────────────────────────────────────────

create or replace function public.redeem_invitation(p_token text, p_user_id uuid)
returns table(group_id_out uuid, group_name_out text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation  invitations%rowtype;
  v_group_name  text;
  v_updated     int;
begin
  select * into v_invitation
  from public.invitations
  where token = p_token
    and status = 'pending'
    and expires_at > now();

  if not found then
    return;
  end if;

  update public.invitations set status = 'accepted' where id = v_invitation.id;

  if v_invitation.group_id is null then
    return next;
    return;
  end if;

  select name into v_group_name from public.groups where id = v_invitation.group_id;

  if exists (
    select 1 from public.group_members
    where group_id = v_invitation.group_id and user_id = p_user_id
  ) then
    group_id_out   := v_invitation.group_id;
    group_name_out := v_group_name;
    return next;
    return;
  end if;

  update public.group_members
  set user_id = p_user_id
  where id = (
    select id from public.group_members
    where group_id = v_invitation.group_id
      and user_id is null
    order by
      case
        when v_invitation.invitee_email is not null
             and display_name ilike split_part(v_invitation.invitee_email, '@', 1) || '%'
        then 0
        else 1
      end,
      created_at asc
    limit 1
  );

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    insert into public.group_members (group_id, user_id)
    values (v_invitation.group_id, p_user_id);
  end if;

  -- Ensure balance row exists — use 3-column PK
  insert into public.group_balances (group_id, user_id, currency_code, balance_cents)
  values (v_invitation.group_id, p_user_id, 'INR', 0)
  on conflict (group_id, user_id, currency_code) do nothing;

  group_id_out   := v_invitation.group_id;
  group_name_out := v_group_name;
  return next;
end;
$$;
