-- Server-authoritative auction clock with three-second bid extensions.
alter table public.shows add column if not exists auction_ends_at timestamptz;

create or replace function public.place_timed_live_bid(target_show uuid,target_product uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  live_show record;
  next_amount numeric(10,2);
  new_end timestamptz;
begin
  select * into live_show from public.shows where id=target_show for update;
  if live_show.id is null or live_show.status<>'live' or live_show.current_product_id<>target_product then
    raise exception 'This product auction is not active';
  end if;
  if live_show.auction_ends_at is null or live_show.auction_ends_at<=now() then
    raise exception 'This product auction has ended';
  end if;
  if live_show.seller_id=auth.uid() then
    raise exception 'A seller cannot bid on their own auction';
  end if;

  select greatest(
    coalesce(max(b.amount),p.starting_bid-1,p.price-1,0)+1,
    coalesce(p.starting_bid,p.price,1)
  ) into next_amount
  from public.products p
  left join public.bids b on b.show_id=target_show and b.product_id=target_product
  where p.id=target_product
  group by p.starting_bid,p.price;

  if next_amount is null then raise exception 'Product not found'; end if;

  new_end:=live_show.auction_ends_at+interval '3 seconds';
  insert into public.bids(show_id,product_id,bidder_id,amount)
  values(target_show,target_product,auth.uid(),next_amount);
  update public.shows set auction_ends_at=new_end where id=target_show;

  return jsonb_build_object('amount',next_amount,'auctionEndsAt',new_end);
end $$;

create or replace function public.finish_live_product_auction(target_show uuid,target_product uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  live_show record;
  winning_bid record;
  created_order uuid;
begin
  select * into live_show from public.shows where id=target_show for update;
  if live_show.id is null or live_show.seller_id<>auth.uid() or live_show.status<>'live'
     or live_show.current_product_id<>target_product then
    raise exception 'You cannot finish this auction';
  end if;
  if live_show.auction_ends_at is null or live_show.auction_ends_at>now() then
    raise exception 'The auction timer is still running';
  end if;

  select bidder_id,amount into winning_bid
  from public.bids
  where show_id=target_show and product_id=target_product
  order by amount desc,created_at asc limit 1;

  if winning_bid.bidder_id is not null then
    insert into public.orders(buyer_id,seller_id,product_id,show_id,total,status,payout_status)
    values(winning_bid.bidder_id,live_show.seller_id,target_product,target_show,winning_bid.amount,'payment_due','held')
    returning id into created_order;
    update public.products set status='sold',stock=0 where id=target_product;
  end if;

  update public.shows set current_product_id=null,auction_ends_at=null where id=target_show;
  return jsonb_build_object('winner',winning_bid.bidder_id,'amount',winning_bid.amount,'orderId',created_order);
end $$;

revoke all on function public.place_timed_live_bid(uuid,uuid) from public,anon;
revoke all on function public.finish_live_product_auction(uuid,uuid) from public,anon;
grant execute on function public.place_timed_live_bid(uuid,uuid) to authenticated;
grant execute on function public.finish_live_product_auction(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
