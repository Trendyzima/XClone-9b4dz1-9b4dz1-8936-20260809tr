# Testagram Cloudflare hosting

Testagram's production web deployment is designed to use Cloudflare Workers as the application origin, with GitHub as the source repository.

## Production flow

GitHub `main`
→ Cloudflare Workers Builds
→ `npm run build`
→ `npx wrangler deploy`
→ Custom Domains
→ `testagram.site`

The Wrangler configuration is the source of truth for the Worker and declares:

- `testagram.site`
- `www.testagram.site`
- Vite `dist/` static assets
- SPA fallback
- Testagram HTTP API routes
- Supabase ActivityPub/OAuth rewrites
- the existing story cleanup schedule

## Cloudflare setup

Connect this GitHub repository to Cloudflare Workers Builds and select `main` as the production branch.

Use:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Root directory: repository root

Workers Builds manages the deployment credential on the Cloudflare side, so this repository does not require Google Cloud credentials or a long-lived Cloudflare token committed to GitHub.

After the first successful deployment, the `custom_domain` entries in `wrangler.jsonc` attach the Worker to the production hostnames. Cloudflare manages the DNS records and certificates for those Custom Domains.

## Runtime secrets

Do not commit production secrets.

The Worker-compatible handlers may require Cloudflare Worker secrets for:

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_PUBLISHABLE_KEY`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_MEDIA_BUCKET`
- `SEND_SMS_HOOK_SECRETS`
- `SMS_GATEWAY_URL`
- `SMS_GATEWAY_API_KEY`
- `SMS_GATEWAY_USERNAME`
- `SMS_SENDER_NAME`
- `SMS_RATE_LIMIT_SECRET`
- `CRON_SECRET`

Only secrets actually required by a route need to be configured.

## Cutover rule

Do not delete the Vercel project or change unrelated DNS records until the Cloudflare Worker has passed production health, readiness, authentication, media, feed, wallet, notifications, News, Fediverse and TV verification.

TV encoder/WebSocket ingest remains a separate migration boundary. The existing HTTP application can move to the Cloudflare Worker without pretending that the TV encoder path has already been migrated.
