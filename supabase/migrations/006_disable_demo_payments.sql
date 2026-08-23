-- Production safety: demo payment mutation must never be callable by app users.
revoke all on function public.demo_pay_order(uuid) from public, anon, authenticated;
drop function if exists public.demo_pay_order(uuid);
notify pgrst, 'reload schema';
