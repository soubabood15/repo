create table if not exists icon7_items (
  id uuid primary key default gen_random_uuid(),
  section text not null,
  item_name text not null,
  price text,
  duration text,
  contact text,
  notes text,
  suggested_reply text,
  order_index int default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);

grant usage on schema public to anon;
grant select on table public.icon7_items to anon;
revoke insert, update, delete on table public.icon7_items from anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.icon7_items to authenticated;

alter table public.icon7_items enable row level security;

drop policy if exists "icon7_items_select_anon" on public.icon7_items;
drop policy if exists "icon7_items_insert_anon" on public.icon7_items;
drop policy if exists "icon7_items_update_anon" on public.icon7_items;
drop policy if exists "icon7_items_delete_anon" on public.icon7_items;
drop policy if exists "icon7_items_select_authenticated" on public.icon7_items;
drop policy if exists "icon7_items_insert_designer" on public.icon7_items;
drop policy if exists "icon7_items_update_designer" on public.icon7_items;
drop policy if exists "icon7_items_delete_designer" on public.icon7_items;

create policy "icon7_items_select_anon"
on public.icon7_items
for select
to anon
using (true);

create policy "icon7_items_select_authenticated"
on public.icon7_items
for select
to authenticated
using (true);

create policy "icon7_items_insert_designer"
on public.icon7_items
for insert
to authenticated
with check (
  exists (
    select 1 from public.trainer_users user_profile
    where user_profile.auth_user_id = auth.uid()
      and user_profile.active = true
      and lower(user_profile.role) in ('trainer','admin')
  )
);

create policy "icon7_items_update_designer"
on public.icon7_items
for update
to authenticated
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
on public.icon7_items
for delete
to authenticated
using (
  exists (
    select 1 from public.trainer_users user_profile
    where user_profile.auth_user_id = auth.uid()
      and user_profile.active = true
      and lower(user_profile.role) in ('trainer','admin')
  )
);

insert into icon7_items
(section, item_name, price, duration, contact, notes, suggested_reply, order_index)
values
('Games', 'Skating - التزلج', '12 دينار على الشخص', '45 دقيقة', null, 'العجال رباعية ويوجد أشخاص للمساعدة', 'التزلج سعره 12 دينار للشخص لمدة 45 دقيقة، والعجال رباعية ويوجد أشخاص للمساعدة.', 1),
('Games', 'Bowling - البولينج', '6 دنانير على الشخص', '10 أدوار', null, 'يوجد حذاء، النمر من 30 إلى 44، تتسع لـ 7 أشخاص', 'البولينج سعره 6 دنانير للشخص، يشمل 10 أدوار، ويوجد حذاء بنمر من 30 إلى 44.', 2),
('Games', 'Trampoline - الترامبولين', '10 دنانير على الشخص', 'ساعة', null, 'من عمر 5 وفوق، وتحت 5 سنوات يحتاج مرافق 18 سنة وفوق', 'الترامبولين سعره 10 دنانير للشخص لمدة ساعة، من عمر 5 سنوات وفوق.', 3),
('Games', 'VR - الواقع الافتراضي', '4 دنانير على الشخص', '3 إلى 5 دقائق', null, 'لعمر 4 سنوات وأكثر', 'الواقع الافتراضي سعره 4 دنانير للشخص، والمدة من 3 إلى 5 دقائق.', 4),
('Food Court', 'Taco Loco', 'حسب الطلب', null, null, 'طعام مكسيكي', 'يوجد Taco Loco في منطقة Food Court ويقدم طعام مكسيكي.', 20),
('General Info', 'Opening Hours', null, '10 صباحًا إلى 12 مساءً', null, 'لا يوجد دخولية للمكان', 'الدوام من الساعة 10 صباحًا إلى 12 مساءً، ولا يوجد دخولية للمكان.', 50);
