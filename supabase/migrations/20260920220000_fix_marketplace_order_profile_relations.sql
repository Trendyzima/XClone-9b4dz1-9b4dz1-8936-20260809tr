-- Restore explicit PostgREST relationships for marketplace orders.
-- Orders already enforce buyer/seller ownership through RLS; these FKs only
-- describe the existing identity relationship so nested profile selects work.

alter table public.orders
  add constraint orders_buyer_id_profiles_fkey
  foreign key (buyer_id) references public.profiles(id) not valid;

alter table public.orders
  add constraint orders_seller_id_profiles_fkey
  foreign key (seller_id) references public.profiles(id) not valid;

alter table public.orders validate constraint orders_buyer_id_profiles_fkey;
alter table public.orders validate constraint orders_seller_id_profiles_fkey;
