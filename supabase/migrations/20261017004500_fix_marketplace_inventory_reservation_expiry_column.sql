-- Fix the reservation expiry worker against the actual table contract.
-- marketplace_inventory_reservations has released_at, not updated_at.
-- The worker runs every minute; the old body failed every run and polluted
-- cron diagnostics while competing with application traffic.
CREATE INDEX IF NOT EXISTS marketplace_inventory_reservations_expiry_idx
  ON public.marketplace_inventory_reservations (expires_at)
  WHERE status = 'held';

CREATE OR REPLACE FUNCTION public.expire_marketplace_inventory_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  n integer := 0;
BEGIN
  WITH expired AS (
    UPDATE public.marketplace_inventory_reservations
    SET status = 'expired',
        released_at = COALESCE(released_at, now())
    WHERE status = 'held'
      AND expires_at <= now()
    RETURNING product_id, quantity
  ),
  totals AS (
    SELECT product_id, sum(quantity)::integer AS quantity
    FROM expired
    GROUP BY product_id
  )
  UPDATE public.products AS p
  SET reserved_inventory_count = greatest(0, p.reserved_inventory_count - t.quantity),
      updated_at = now()
  FROM totals AS t
  WHERE p.id = t.product_id;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$function$;
