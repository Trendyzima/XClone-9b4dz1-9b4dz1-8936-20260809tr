/**
 * Marketplace is intentionally unavailable until its catalog, wishlist,
 * inventory reservation, checkout and delivery flows are backed by the
 * canonical Testagram Backend API.
 *
 * Do not restore direct Supabase calls or a compatibility data-plane shim.
 * Re-enable the full experience only after the Backend commerce contract,
 * authorization, idempotency and settlement tests are deployed.
 */
export default function MarketplacePage() {
  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-6 py-16">
      <section className="w-full max-w-xl text-center" aria-labelledby="marketplace-unavailable-title">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
          <span aria-hidden="true" className="text-3xl">🛍️</span>
        </div>
        <h1 id="marketplace-unavailable-title" className="text-2xl font-bold">
          Marketplace temporarily unavailable
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          We’re rebuilding the marketplace on Testagram’s secure Backend API.
          Product browsing, wishlists, inventory reservations, checkout and
          delivery tracking are paused until those services are verified.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          No payment or inventory action can be started from this page.
        </p>
      </section>
    </main>
  );
}
