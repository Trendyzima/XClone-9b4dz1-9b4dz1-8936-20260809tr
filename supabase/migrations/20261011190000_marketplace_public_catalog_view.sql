-- Safe public catalog projection: expose only fields required to discover and
-- purchase active products. Private media asset metadata remains owner-only.
create or replace view public.marketplace_public_products
with (security_barrier = true, security_invoker = true)
as
select
  p.id,
  p.seller_id,
  p.name,
  p.description,
  p.price_minor,
  p.currency,
  p.status,
  p.created_at,
  p.local_delivery,
  p.delivery_fee_minor,
  p.delivery_eta,
  p.sales_count,
  greatest(0, coalesce(p.inventory_count, 0) - coalesce(p.reserved_inventory_count, 0)) as available_inventory,
  case when m.status = 'ready' then m.media_url else null end as media_url,
  pr.username as seller_username,
  pr.display_name as seller_display_name,
  pr.avatar_url as seller_avatar_url
from public.products p
left join public.media_assets m on m.id = p.media_asset_id and m.owner_id = p.seller_id and m.status = 'ready'
left join public.profiles pr on pr.id = p.seller_id
where p.status = 'active';

revoke all on public.marketplace_public_products from public;
grant select on public.marketplace_public_products to anon, authenticated;
