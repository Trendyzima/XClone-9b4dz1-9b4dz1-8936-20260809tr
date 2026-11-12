import MarketplacePage from './MarketplacePage';

// Keep the existing /shop route stable while the marketplace is served by the
// canonical Backend catalog. Checkout is intentionally not simulated here.
export default function ShoppingMallPage() {
  return <MarketplacePage />;
}
