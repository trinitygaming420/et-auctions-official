-- Finish one product auction while keeping the livestream active.
create or replace function public.finish_live_product_auction(target_show uuid,target_product uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  seller uuid;
  winning_bid record;
  created_order uuid;
begin
  select seller_id into seller
  from public.shows
  where id=target_show and status='live' and current_product_id=target_product;

  if seller is null or seller<>auth.uid() then
    raise exception 'You cannot finish this auction';
  end if;

  select bidder_id,amount into winning_bid
  from public.bids
  where show_id=target_show and product_id=target_product
  order by amount desc,created_at asc
  limit 1;

  if winning_bid.bidder_id is not null then
    insert into public.orders(buyer_id,seller_id,product_id,show_id,total,status,payout_status)
    values(winning_bid.bidder_id,seller,target_product,target_show,winning_bid.amount,'payment_due','held')
    returning id into created_order;
    update public.products set status='sold',stock=0 where id=target_product and seller_id=seller;
  end if;

  update public.shows set current_product_id=null where id=target_show and seller_id=seller;

  return jsonb_build_object('winner',winning_bid.bidder_id,'amount',winning_bid.amount,'orderId',created_order);
end $$;

revoke all on function public.finish_live_product_auction(uuid,uuid) from public,anon;
grant execute on function public.finish_live_product_auction(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
