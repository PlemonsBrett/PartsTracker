-- Trigger-only functions must not be callable through /rest/v1/rpc.
revoke execute on function public.log_quantity() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
