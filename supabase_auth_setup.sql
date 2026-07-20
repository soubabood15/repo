-- Run once before using the secure Add User action.
-- Passwords are owned by Supabase Auth and must not be stored here.
alter table public.trainer_users
  add column if not exists auth_user_id uuid;

alter table public.trainer_users
  alter column password drop not null;

create unique index if not exists trainer_users_auth_user_id_unique
  on public.trainer_users(auth_user_id)
  where auth_user_id is not null;

create unique index if not exists trainer_users_username_lower_unique
  on public.trainer_users(lower(username));

-- Edge Functions use service_role for trusted server-side user management.
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.trainer_users to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Signed-in users need to read their own profile after Supabase Auth login.
-- This fixes "Could not verify account access" without exposing other profiles.
grant usage on schema public to authenticated;
grant select on table public.trainer_users to authenticated;

drop policy if exists "Authenticated user can read own trainer profile"
  on public.trainer_users;
create policy "Authenticated user can read own trainer profile"
  on public.trainer_users
  for select
  to authenticated
  using (auth_user_id = auth.uid());

-- Shared authorization helper used by project knowledge-table policies.
create or replace function public.is_active_knowledge_designer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trainer_users
    where auth_user_id = auth.uid()
      and active = true
      and lower(role) in ('trainer','admin')
  );
$$;

revoke all on function public.is_active_knowledge_designer() from public;
grant execute on function public.is_active_knowledge_designer() to authenticated;

notify pgrst, 'reload schema';
