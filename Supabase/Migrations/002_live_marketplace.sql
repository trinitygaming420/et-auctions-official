create table if not exists public.seller_applications (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.shows add column if not exists current_product_id uuid references public.products(id);
alter table public.shows add column if not exists ended_at timestamptz;
alter table public.orders add column if not exists payout_status text not null default 'held' check (payout_status in ('held','released'));
alter table public.orders add column if not exists paid_at timestamptz;

create table if not exists public.ratings (
  id bigint generated always as identity primary key,
  order_id uuid unique references public.orders(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  stars int not null check (stars between 1 and 5),
  review text check (char_length(review) <= 500),
  created_at timestamptz not null default now()
);

create table if not exists public.giveaway_entries (
  giveaway_id uuid references public.giveaways(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (giveaway_id,user_id)
);

alter table public.seller_applications enable row level security;
alter table public.ratings enable row level security;
alter table public.giveaway_entries enable row level security;

drop policy if exists "own seller application" on public.seller_applications;
create policy "own seller application" on public.seller_applications for insert with check (auth.uid()=user_id);
drop policy if exists "read own seller application" on public.seller_applications;
create policy "read own seller application" on public.seller_applications for select using (
  auth.uid()=user_id or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')
);
drop policy if exists "ratings readable" on public.ratings;
create policy "ratings readable" on public.ratings for select using (true);
drop policy if exists "buyers rate orders" on public.ratings;
create policy "buyers rate orders" on public.ratings for insert with check (auth.uid()=buyer_id);
drop policy if exists "entries readable" on public.giveaway_entries;
create policy "entries readable" on public.giveaway_entries for select using (true);
drop policy if exists "enter giveaway" on public.giveaway_entries;
create policy "enter giveaway" on public.giveaway_entries for insert with check (auth.uid()=user_id);

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role='admin');
$$;

drop policy if exists "admin reads all orders" on public.orders;
create policy "admin reads all orders" on public.orders for select using (public.is_admin());
drop policy if exists "admin updates orders" on public.orders;
create policy "admin updates orders" on public.orders for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin reads applications" on public.seller_applications;
create policy "admin reads applications" on public.seller_applications for select using (public.is_admin());

create or replace function public.admin_review_seller(target_user uuid, decision text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if decision not in ('approved','declined') then raise exception 'Invalid decision'; end if;
  update public.seller_applications set status=decision, reviewed_at=now() where user_id=target_user;
  update public.profiles set role=case when decision='approved' then 'seller' else 'buyer' end,
    seller_approved=(decision='approved') where id=target_user;
end $$;

create or replace function public.admin_release_payout(target_order uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  update public.orders set payout_status='released', paid_at=now() where id=target_order;
end $$;

create or replace function public.protect_profile_privileges()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.uid()=old.id and not public.is_admin() then
    new.role=old.role;
    new.seller_approved=old.seller_approved;
  end if;
  return new;
end $$;
drop trigger if exists protect_profile_privileges on public.profiles;
create trigger protect_profile_privileges before update on public.profiles for each row execute procedure public.protect_profile_privileges();

do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.seller_applications;
exception when duplicate_object then null; end $$;

update public.profiles p set role='admin', seller_approved=true
from auth.users u where p.id=u.id and lower(u.email)=lower('xxtgxxgangxx@gmail.com');

