-- Lock down the first-party GIF catalog: clients may read active rows, but cannot mutate catalog data.
revoke insert, update, delete, truncate, references, trigger on public.gif_catalog from anon, authenticated;
grant select on public.gif_catalog to anon, authenticated;

revoke all on function public.record_gif_usage(uuid) from public;
grant execute on function public.record_gif_usage(uuid) to anon, authenticated;

revoke all on function public.search_gif_catalog(text,text,integer) from public;
grant execute on function public.search_gif_catalog(text,text,integer) to anon, authenticated;
