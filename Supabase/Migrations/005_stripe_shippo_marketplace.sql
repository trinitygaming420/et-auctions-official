-- Stripe Connect, buyer-paid shipping, labels, tracking and payout eligibility.

alter table public.profiles add column if not exists stripe_account_id text;
alter table public.profiles add column if not exists stripe_onboarding_complete boolean not null default false;
alter table public.profiles add column if not exists payouts_enabled boolean not null default false;
alter table public.profiles add column if not exists shipping_address jsonb;

alter table public.products add column if not exists weight_oz numeric(10,2) not null default 8;
alter table public.products add column if not exists length_in numeric(10,2) not null default 8;
alter table public.products add column if not exists width_in numeric(10,2) not null default 6;
alter table public.products add column if not exists height_in numeric(10,2) not null default 4;

alter table public.orders add column if not exists subtotal numeric(10,2);
alter table public.orders add column if not exists shipping_total numeric(10,2) not null default 0;
alter table public.orders add column if not exists stripe_checkout_session_id text;
alter table public.orders add column if not exists shippo_shipment_id text;
alter table public.orders add column if not exists shippo_rate_id text;
alter table public.orders add column if not exists shipping_label_url text;
alter table public.orders add column if not exists payout_eligible_at timestamptz;

update public.orders set subtotal=total where subtotal is null;

create or replace function public.save_my_shipping_address(address_data jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if nullif(trim(address_data->>'name'),'') is null
    or nullif(trim(address_data->>'street1'),'') is null
    or nullif(trim(address_data->>'city'),'') is null
    or nullif(trim(address_data->>'state'),'') is null
    or nullif(trim(address_data->>'zip'),'') is null then
    raise exception 'Name, street, city, state and ZIP are required';
  end if;
  update public.profiles set shipping_address=address_data where id=auth.uid();
end $$;

grant execute on function public.save_my_shipping_address(jsonb) to authenticated;
notify pgrst, 'reload schema';

