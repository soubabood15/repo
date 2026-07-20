-- Run this once in Supabase SQL Editor.
-- Public visitors can read ICON7; only active trainers/admins can modify it.
grant usage on schema public to anon, authenticated;
grant select on table public.icon7_items to anon;
revoke insert, update, delete on table public.icon7_items from anon;
grant select, insert, update, delete on table public.icon7_items to authenticated;

alter table public.icon7_items enable row level security;

drop policy if exists "icon7_items_insert_anon" on public.icon7_items;
drop policy if exists "icon7_items_update_anon" on public.icon7_items;
drop policy if exists "icon7_items_delete_anon" on public.icon7_items;
drop policy if exists "icon7_items_select_authenticated" on public.icon7_items;
drop policy if exists "icon7_items_insert_designer" on public.icon7_items;
drop policy if exists "icon7_items_update_designer" on public.icon7_items;
drop policy if exists "icon7_items_delete_designer" on public.icon7_items;

create policy "icon7_items_select_authenticated"
on public.icon7_items for select to authenticated
using (true);

create policy "icon7_items_insert_designer"
on public.icon7_items for insert to authenticated
with check (
  exists (
    select 1 from public.trainer_users user_profile
    where user_profile.auth_user_id = auth.uid()
      and user_profile.active = true
      and lower(user_profile.role) in ('trainer','admin')
  )
);

create policy "icon7_items_update_designer"
on public.icon7_items for update to authenticated
using (
  exists (
    select 1 from public.trainer_users user_profile
    where user_profile.auth_user_id = auth.uid()
      and user_profile.active = true
      and lower(user_profile.role) in ('trainer','admin')
  )
)
with check (
  exists (
    select 1 from public.trainer_users user_profile
    where user_profile.auth_user_id = auth.uid()
      and user_profile.active = true
      and lower(user_profile.role) in ('trainer','admin')
  )
);

create policy "icon7_items_delete_designer"
on public.icon7_items for delete to authenticated
using (
  exists (
    select 1 from public.trainer_users user_profile
    where user_profile.auth_user_id = auth.uid()
      and user_profile.active = true
      and lower(user_profile.role) in ('trainer','admin')
  )
);

notify pgrst, 'reload schema';
