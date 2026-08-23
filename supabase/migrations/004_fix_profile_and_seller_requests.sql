-- Reliable account-name saving and seller-approval requests.

create or replace function public.save_my_display_name(new_name text)
returns public.profiles
language plpgsql
security definer
set search_path=public
as $$
declare updated_profile public.profiles;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if nullif(trim(new_name),'') is null then raise exception 'Enter a display name'; end if;
  if char_length(trim(new_name)) > 50 then raise exception 'Display name must be 50 characters or fewer'; end if;

  update public.profiles
  set display_name=trim(new_name)
  where id=auth.uid()
  returning * into updated_profile;

  if updated_profile.id is null then raise exception 'Profile was not found'; end if;
  return updated_profile;
end $$;

create or replace function public.request_seller_approval()
returns public.seller_applications
language plpgsql
security definer
set search_path=public
as $$
declare current_profile public.profiles;
declare application public.seller_applications;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;

  select * into current_profile from public.profiles where id=auth.uid();
  if current_profile.id is null then raise exception 'Profile was not found'; end if;
  if current_profile.seller_approved then raise exception 'This account is already an approved seller'; end if;

  insert into public.seller_applications(user_id,status,created_at,reviewed_at)
  values(auth.uid(),'pending',now(),null)
  on conflict(user_id) do update
  set status='pending', created_at=now(), reviewed_at=null
  returning * into application;

  return application;
end $$;

grant execute on function public.save_my_display_name(text) to authenticated;
grant execute on function public.request_seller_approval() to authenticated;

