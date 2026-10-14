import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const router = read('mobile/lib/app/testagram_app.dart');
const page = read('mobile/lib/features/marketplace/shopping_mall_page.dart');
const policy = read('mobile/lib/features/marketplace/shopping_mall_policy.dart');
const tests = read('mobile/test/features/marketplace/shopping_mall_policy_test.dart');
const view = read('supabase/migrations/20261011190000_marketplace_public_catalog_view.sql');
const migration = read('supabase/migrations/20261014125029_marketplace_public_category_projection.sql');
const checkout = read('supabase/migrations/20261006120000_marketplace_10of10_hardening.sql');
const checkoutLifecycle = read('supabase/migrations/20261006143000_marketplace_order_lifecycle_hardening.sql');
const reservationContract = read('supabase/migrations/20261006143000_marketplace_inventory_reservation_contract.sql');
const routeInventory = read('scripts/update-flutter-route-parity.mjs');
const workflow = read('.github/workflows/flutter-clients.yml');
const failures = [];
const requireText = (source, pattern, message) => { if (!pattern.test(source)) failures.push(message); };

requireText(router, /path:\s*'\/shop'[\s\S]{0,100}ShoppingMallPage\(\)/, '/shop must render the dedicated Flutter Mall.');
requireText(router, /path:\s*'\/mall'[\s\S]{0,100}ShoppingMallPage\(\)/, '/mall alias must render the dedicated Flutter Mall.');
requireText(page, /scrollDirection:\s*Axis\.horizontal/, 'The Mall must have horizontal product/category carousels.');
requireText(page, /CustomScrollView\([\s\S]*SliverGrid/, 'The Mall must support vertical scrolling and a vertically browsable product catalog.');
requireText(page, /SharedPreferences[\s\S]{0,180}testagram\.mall\.cart\.v1/, 'Cart must persist locally without storing credentials.');
requireText(page, /missingCategoryProjection[\s\S]*includeCategory:\s*false/, 'Catalog loading must remain compatible until the category projection migration is deployed.');
requireText(page, /from\('marketplace_public_products'\)[\s\S]{0,260}available_inventory[\s\S]{0,200}media_url/, 'Product discovery must use the safe public catalog projection.');
requireText(page, /rpc\([\s\S]{0,100}'place_marketplace_order'[\s\S]*'p_idempotency_key'[\s\S]*'p_delivery_mode'/, 'Checkout must use the server-side idempotent order RPC and delivery contract.');
requireText(page, /rpc\([\s\S]{0,100}'reserve_marketplace_inventory'[\s\S]*'p_reservation_key'[\s\S]*'p_ttl_seconds'[\s\S]*rpc\([\s\S]{0,100}'place_marketplace_order'[\s\S]*'p_reservation_key'/, 'Checkout must reserve stock before placing an order and pass the reservation key to the server transaction.');
requireText(page, /testagram\.mall\.pending_checkout\.v1[\s\S]*_loadOrCreatePendingCheckoutKey[\s\S]*_clearPendingCheckoutKey/, 'Checkout retries must persist and reuse an idempotency key until the server confirms the order.');
requireText(page, /_checkoutBusyProducts\.contains\(product\.id\)/, 'Duplicate taps must not start concurrent checkout attempts for the same product.');
requireText(page, /rpc\('get_my_wallet'\)/, 'Wallet display must use the existing authenticated wallet RPC.');
requireText(page, /from\('wishlists'\)/, 'Wishlist must use the existing authenticated wishlist table.');
requireText(policy, /matchesCategory[\s\S]*safeImageUrl/, 'Mall policy must centralize category matching and safe image URL handling.');
requireText(tests, /category keywords find products[\s\S]*rejects unsafe or non-HTTPS URLs/s, 'Mall unit tests must cover category matching and image URL safety.');
requireText(view, /security_barrier\s*=\s*true,\s*security_invoker\s*=\s*true/, 'Base catalog projection must remain security-invoker and security-barrier protected.');
requireText(migration, /add column if not exists category text not null default 'other'[\s\S]*p\.category[\s\S]*where p\.status = 'active'/, 'Category projection must add a backward-compatible category field and expose it only for active products.');
requireText(checkout, /perform pg_advisory_xact_lock[\s\S]*before_balance\s*<\s*debit/, 'Server checkout must retain transaction-level locking and wallet balance validation.');
requireText(checkoutLifecycle, /select id into old_oid[\s\S]{0,180}marketplace_idempotency_key=p_idempotency_key[\s\S]{0,100}if old_oid is not null then return old_oid/, 'The server must return an existing order for a repeated idempotency key before attempting a second charge.');
requireText(reservationContract, /reserve_marketplace_inventory[\s\S]*p_product_id uuid, p_quantity integer, p_reservation_key text, p_ttl_seconds integer[\s\S]*place_marketplace_order[\s\S]*p_reservation_key text[\s\S]*grant execute on function public\.reserve_marketplace_inventory\(uuid,integer,text,integer\) to authenticated/, 'Server migration must expose authenticated stock reservation and require its key for checkout.');
requireText(routeInventory, /'\/shop': 'Dedicated native Flutter Testagram Mall/, 'Route parity inventory must document the dedicated Mall and its acceptance caveat.');
requireText(workflow, /validate-shopping-mall-contract\.mjs/, 'Flutter CI must execute the Mall contract validator.');

if (failures.length) {
  console.error('Shopping Mall contract validation failed:\n- ' + failures.join('\n- '));
  process.exitCode = 1;
} else {
  console.log('Shopping Mall contract passed: native routes, horizontal/vertical browsing, safe catalog projection, persistent cart, wishlist, wallet, atomic server checkout, and CI wiring.');
}
