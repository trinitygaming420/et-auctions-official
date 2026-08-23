-- E&T Auctions
-- Manual seller payout request system
-- Buyer payments remain in the PLATFORM Stripe account.
-- Seller funds are transferred only after an admin approves a payout request.

begin;

alter table public.orders
  add column if not exists platform_fee numeric(12,2) not null default 0,
  add column if not exists seller_payout_amount numeric(12,2) not null default 0,
  add column if not exists payout_status text not null default 'not_requested',
  add column if not exists stripe_payment_intent_id text,
  add column if not exists delivered_at timestamptz,
  add column if not exists payout_eligible_at timestamptz,
  add column if not exists payout_paid_at timestamptz,
  add column if not exists refunded_at timestamptz,
  add column if not exists stripe_refund_id text;

create table if not exists public.payout_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  platform_fee numeric(12,2) not null default 0,
  status text not null default 'pending'
    check (status in ('pending','approved','paid','rejected','reversed')),
  stripe_transfer_id text unique,
  transfer_reversal_id text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  paid_at timestamptz,
  rejection_reason text
);

create index if not exists payout_requests_seller_id_idx
  on public.payout_requests(seller_id);

create index if not exists payout_requests_status_idx
  on public.payout_requests(status);

create index if not exists payout_requests_requested_at_idx
  on public.payout_requests(requested_at desc);

alter table public.payout_requests enable row level security;

drop policy if exists "Sellers can view own payout requests"
  on public.payout_requests;

create policy "Sellers can view own payout requests"
  on public.payout_requests
  for select
  to authenticated
  using (seller_id = auth.uid());

drop policy if exists "Admins can view all payout requests"
  on public.payout_requests;

create policy "Admins can view all payout requests"
  on public.payout_requests
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

-- Creation/approval/payment of payout requests is intentionally handled
-- through the marketplace-api Edge Function using the service-role key.
-- There is no direct authenticated INSERT/UPDATE policy here, preventing
-- sellers from approving or marking their own payout as paid.

commit;
