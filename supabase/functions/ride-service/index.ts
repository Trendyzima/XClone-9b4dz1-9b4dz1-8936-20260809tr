import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const RIDE_PRICING = {
  standard: { base: 150, perKm: 55 },
  comfort: { base: 220, perKm: 75 },
  xl: { base: 300, perKm: 95 },
} as const;

function distanceKm(lat1:number, lon1:number, lat2:number, lon2:number) {
  const rad = (x:number) => x * Math.PI / 180;
  const a =
    Math.sin(rad(lat2-lat1)/2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2-lon1)/2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

Deno.serve(async req => {
  try {
    const auth = req.headers.get("Authorization") || "";
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "Authentication required" }, 401);

    const b = await req.json().catch(() => ({}));
    const method = String(b.method || "GET").toUpperCase();
    const path = String(b.path || "");

    if (method === "GET") {
      const { data, error } = await sb.from("rides").select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return json({ data: { rides: data || [] } });
    }

    if (method === "POST" && path === "/api/v1/rides") {
      const p = b.payload || {};
      const required = [
        "pickup_latitude", "pickup_longitude",
        "dropoff_latitude", "dropoff_longitude",
        "pickup_address", "dropoff_address",
      ];
      if (required.some(k => p[k] === undefined || p[k] === null || String(p[k]).trim() === "")) {
        return json({ error: "Incomplete ride request" }, 400);
      }

      const key = String(p.idempotency_key || "").trim();
      if (!/^[A-Za-z0-9:_-]{8,128}$/.test(key)) {
        return json({ error: "A valid idempotency key is required" }, 400);
      }

      const lat1 = Number(p.pickup_latitude);
      const lon1 = Number(p.pickup_longitude);
      const lat2 = Number(p.dropoff_latitude);
      const lon2 = Number(p.dropoff_longitude);
      if (![lat1, lon1, lat2, lon2].every(Number.isFinite) ||
          lat1 < -90 || lat1 > 90 || lat2 < -90 || lat2 > 90 ||
          lon1 < -180 || lon1 > 180 || lon2 < -180 || lon2 > 180) {
        return json({ error: "Invalid ride coordinates" }, 400);
      }

      const pickupAddress = String(p.pickup_address).trim().slice(0, 500);
      const dropoffAddress = String(p.dropoff_address).trim().slice(0, 500);
      const rideType = String(p.ride_type || "standard") as keyof typeof RIDE_PRICING;
      if (!(rideType in RIDE_PRICING)) return json({ error: "Unsupported ride type" }, 400);

      const distance = distanceKm(lat1, lon1, lat2, lon2);
      if (!Number.isFinite(distance) || distance <= 0 || distance > 500) {
        return json({ error: "Ride route is outside the supported distance range" }, 400);
      }

      const pricing = RIDE_PRICING[rideType];
      const fare = Math.max(pricing.base, Math.round(pricing.base + distance * pricing.perKm));

      const { data: existing, error: existingError } = await sb.from("rides")
        .select("*")
        .eq("user_id", user.id)
        .eq("idempotency_key", key)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) return json({ data: existing, duplicate: true });

      const { data, error } = await sb.from("rides").insert({
        user_id: user.id,
        pickup_latitude: lat1,
        pickup_longitude: lon1,
        dropoff_latitude: lat2,
        dropoff_longitude: lon2,
        pickup_address: pickupAddress,
        dropoff_address: dropoffAddress,
        ride_type: rideType,
        status: "requested",
        fare,
        currency: "KES",
        distance_km: Number(distance.toFixed(2)),
        duration_minutes: null,
        idempotency_key: key,
      }).select().single();

      if (error) {
        if (error.code === "23505") {
          const { data: duplicate, error: duplicateError } = await sb.from("rides")
            .select("*").eq("user_id", user.id).eq("idempotency_key", key).maybeSingle();
          if (duplicateError) throw duplicateError;
          if (duplicate) return json({ data: duplicate, duplicate: true });
        }
        throw error;
      }

      return json({ data, duplicate: false });
    }

    return json({ error: "Unsupported ride operation" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Ride service failed" }, 500);
  }
});