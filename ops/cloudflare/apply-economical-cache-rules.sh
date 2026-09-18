#!/usr/bin/env bash
set -euo pipefail

# Economical Cloudflare cache policy for Testagram.
#
# Safety properties:
# - never changes DNS
# - never creates a Worker
# - refuses to cache an unproxied production hostname
# - only creates/updates the dedicated cache-rules phase
# - only caches the explicitly public Vercel edge capability endpoint
# - preserves the origin's 60s s-maxage / 300s stale-while-revalidate policy
#
# Required:
#   CLOUDFLARE_API_TOKEN
# Optional:
#   CF_ZONE_NAME=testagram.site
#   CF_HOSTNAME=www.testagram.site
#   CF_DRY_RUN=1

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN in your shell; never commit or paste it into the repository.}"
: "${CF_ZONE_NAME:=testagram.site}"
: "${CF_HOSTNAME:=www.testagram.site}"

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

API="https://api.cloudflare.com/client/v4"
AUTH=(-H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json")

cf_get() {
  curl -fsS "$@" "${AUTH[@]}"
}

cf_write() {
  curl -fsS "$@" "${AUTH[@]}" --header "Content-Type: application/json"
}

echo "== Cloudflare token =="
VERIFY="$(cf_get "$API/user/tokens/verify")"
echo "$VERIFY" | jq -e '.success == true' >/dev/null
echo "token: valid"

echo "== Zone =="
ZONE="$(cf_get "$API/zones?name=${CF_ZONE_NAME}&status=active")"
ZONE_ID="$(echo "$ZONE" | jq -r '.result[0].id // empty')"
[ -n "$ZONE_ID" ] || { echo "Active Cloudflare zone not found: $CF_ZONE_NAME" >&2; exit 1; }
echo "zone: $CF_ZONE_NAME"
echo "zone_id: $ZONE_ID"

echo "== DNS safety check =="
DNS="$(cf_get "$API/zones/$ZONE_ID/dns_records?name=${CF_HOSTNAME}&per_page=100")"
PROXIED="$(echo "$DNS" | jq -r --arg hostname "$CF_HOSTNAME" '[.result[] | select(.name == $hostname) | .proxied] | any')"
if [ "$PROXIED" != "true" ]; then
  echo "Refusing to install cache rules: $CF_HOSTNAME is not currently proxied through Cloudflare." >&2
  echo "No DNS changes were made." >&2
  exit 2
fi
echo "hostname: $CF_HOSTNAME"
echo "proxied: true"

EXPRESSION='(http.host eq "www.testagram.site" and http.request.method eq "GET" and http.request.uri.path eq "/api/public-capability")'
REF="testagram_public_capability_edge_v1"

RULE_JSON="$(jq -n   --arg expression "$EXPRESSION"   --arg ref "$REF"   '{
    ref: $ref,
    description: "Cache only the unauthenticated public capability edge endpoint; preserve origin TTLs",
    expression: $expression,
    action: "set_cache_settings",
    action_parameters: {
      cache: true,
      edge_ttl: { mode: "respect_origin" },
      browser_ttl: { mode: "respect_origin" }
    }
  }')"

echo "== Cache ruleset =="
ENTRY="$(cf_get "$API/zones/$ZONE_ID/rulesets/phases/http_request_cache_settings/entrypoint")"
HAS_RULESET="$(echo "$ENTRY" | jq -r '.success == true and (.result.id // "") != ""')"

if [ "$HAS_RULESET" != "true" ]; then
  echo "No cache-rules entrypoint exists; creating a minimal zone ruleset."
  if [ "${CF_DRY_RUN:-0}" = "1" ]; then
    echo "$RULE_JSON" | jq .
    echo "DRY RUN: would create http_request_cache_settings entrypoint."
    exit 0
  fi
  CREATED="$(curl -fsS "$API/zones/$ZONE_ID/rulesets" \
    "${AUTH[@]}" \
    --request POST \
    --json "$(jq -n --argjson rule "$RULE_JSON" '{
      name: "Testagram economical cache rules",
      description: "Minimal CDN cache policy for explicitly public Vercel edge responses",
      kind: "zone",
      phase: "http_request_cache_settings",
      rules: [$rule]
    }')")"
  echo "$CREATED" | jq -e '.success == true' >/dev/null
  echo "cache ruleset: created"
else
  RULESET_ID="$(echo "$ENTRY" | jq -r '.result.id')"
  EXISTS="$(echo "$ENTRY" | jq --arg ref "$REF" '[.result.rules[]? | select(.ref == $ref)] | length > 0')"
  if [ "$EXISTS" = "true" ]; then
    echo "cache rule: already present ($REF)"
  elif [ "${CF_DRY_RUN:-0}" = "1" ]; then
    echo "$RULE_JSON" | jq .
    echo "DRY RUN: would add $REF to ruleset $RULESET_ID"
    exit 0
  else
    ADDED="$(curl -fsS "$API/zones/$ZONE_ID/rulesets/$RULESET_ID/rules" \
      "${AUTH[@]}" \
      --request POST \
      --json "$RULE_JSON")"
    echo "$ADDED" | jq -e '.success == true' >/dev/null
    echo "cache rule: added ($REF)"
  fi
fi

echo "== Final policy =="
FINAL="$(cf_get "$API/zones/$ZONE_ID/rulesets/phases/http_request_cache_settings/entrypoint")"
echo "$FINAL" | jq '{
  success,
  result: {
    id: .result.id,
    phase: .result.phase,
    version: .result.version,
    rules: [.result.rules[]? | {
      ref,
      enabled,
      action,
      expression,
      action_parameters
    }]
  }
}'

echo "Done. DNS was not modified and no Worker was created."
