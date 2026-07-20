-- Run this once in Supabase SQL Editor.
-- Saraya stays publicly readable; only active trainers/admins can modify items.
grant usage on schema public to anon, authenticated;

create or replace function public.is_active_knowledge_designer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trainer_users
    where auth_user_id = auth.uid()
      and active = true
      and lower(role) in ('trainer','admin')
  );
$$;
revoke all on function public.is_active_knowledge_designer() from public;
grant execute on function public.is_active_knowledge_designer() to authenticated;

grant select on table public.saraya_kb_sections to anon, authenticated;
grant select on table public.saraya_kb_items to anon, authenticated;
revoke insert, update, delete on table public.saraya_kb_sections from anon;
revoke insert, update, delete on table public.saraya_kb_items from anon;
grant insert, update, delete on table public.saraya_kb_sections to authenticated;
grant insert, update, delete on table public.saraya_kb_items to authenticated;

alter table public.saraya_kb_sections enable row level security;
alter table public.saraya_kb_items enable row level security;

drop policy if exists "saraya_sections_public_read" on public.saraya_kb_sections;
drop policy if exists "saraya_sections_authenticated_read" on public.saraya_kb_sections;
drop policy if exists "saraya_sections_designer_insert" on public.saraya_kb_sections;
drop policy if exists "saraya_sections_designer_update" on public.saraya_kb_sections;
drop policy if exists "saraya_sections_designer_delete" on public.saraya_kb_sections;
drop policy if exists "saraya_items_public_read" on public.saraya_kb_items;
drop policy if exists "saraya_items_authenticated_read" on public.saraya_kb_items;
drop policy if exists "saraya_items_designer_insert" on public.saraya_kb_items;
drop policy if exists "saraya_items_designer_update" on public.saraya_kb_items;
drop policy if exists "saraya_items_designer_delete" on public.saraya_kb_items;

create policy "saraya_sections_public_read"
on public.saraya_kb_sections for select to anon using (true);
create policy "saraya_sections_authenticated_read"
on public.saraya_kb_sections for select to authenticated using (true);
create policy "saraya_items_public_read"
on public.saraya_kb_items for select to anon using (true);
create policy "saraya_items_authenticated_read"
on public.saraya_kb_items for select to authenticated using (true);

create policy "saraya_sections_designer_insert"
on public.saraya_kb_sections for insert to authenticated
with check (public.is_active_knowledge_designer());
create policy "saraya_sections_designer_update"
on public.saraya_kb_sections for update to authenticated
using (public.is_active_knowledge_designer())
with check (public.is_active_knowledge_designer());
create policy "saraya_sections_designer_delete"
on public.saraya_kb_sections for delete to authenticated
using (public.is_active_knowledge_designer());

create policy "saraya_items_designer_insert"
on public.saraya_kb_items for insert to authenticated
with check (public.is_active_knowledge_designer());
create policy "saraya_items_designer_update"
on public.saraya_kb_items for update to authenticated
using (public.is_active_knowledge_designer())
with check (public.is_active_knowledge_designer());
create policy "saraya_items_designer_delete"
on public.saraya_kb_items for delete to authenticated
using (public.is_active_knowledge_designer());

notify pgrst, 'reload schema';
