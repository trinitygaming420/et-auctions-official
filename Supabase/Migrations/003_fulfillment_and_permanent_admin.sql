-- Permanent owner access plus demo checkout and order fulfillment.

alter table public.orders add column if not exists shipping_carrier text;
alter table public.orders add column if not exists packed_at timestamptz;
alter table public.orders add column if not exists shipped_at timestamptz;
alter table public.orders add column if not exists delivered_at timestamptz;
alter table public.orders add column if not exists payment_method text;

create or replace function public.apply_owner_privileges()
returns trigger language plpgsql security definer set search_path=public as $$
declare account_email text;
begin
  select lower(email) into account_email from auth.users where id=new.id;
  if account_email='xxtgxxgangxx@gmail.com' then
    new.role='admin';
    new.seller_approved=true;
  end if;
  return new;
end $$;

drop trigger if exists apply_owner_privileges on public.profiles;
create trigger apply_owner_privileges
before insert or update on public.profiles
for each row execute procedure public.apply_owner_privileges();

update public.profiles p
set role='admin', seller_approved=true
from auth.users u
where p.id=u.id and lower(u.email)='xxtgxxgangxx@gmail.com';

drop policy if exists "seller updates own orders" on public.orders;
create policy "seller updates own orders" on public.orders for update
using (auth.uid()=seller_id)
with check (auth.uid()=seller_id);

create or replace function public.demo_pay_order(target_order uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.orders
  set status='paid', payment_method='demo', paid_at=now()
  where id=target_order and buyer_id=auth.uid() and status='payment_due';
  if not found then raise exception 'Order is not available for payment'; end if;
end $$;

create or replace function public.seller_pack_order(target_order uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.orders set status='packed', packed_at=now()
  where id=target_order and seller_id=auth.uid() and status='paid';
  if not found then raise exception 'Only a paid order can be packed'; end if;
end $$;

create or replace function public.seller_ship_order(
  target_order uuid,
  carrier_name text,
  tracking_code text
)
returns void language plpgsql security definer set search_path=public as $$
begin
  if nullif(trim(carrier_name),'') is null or nullif(trim(tracking_code),'') is null then
    raise exception 'Carrier and tracking number are required';
  end if;
  update public.orders
  set status='shipped', shipping_carrier=trim(carrier_name),
      tracking_number=trim(tracking_code), shipped_at=now()
  where id=target_order and seller_id=auth.uid() and status in ('paid','packed');
  if not found then raise exception 'Order is not ready to ship'; end if;
end $$;

grant execute on function public.demo_pay_order(uuid) to authenticated;
grant execute on function public.seller_pack_order(uuid) to authenticated;
grant execute on function public.seller_ship_order(uuid,text,text) to authenticated;

