#!/usr/bin/env bash
set -euo pipefail
ROOT=/opt/testagram-mail
cd "$ROOT"

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( node_major < 22 )); then
  echo "Testagram Mail requires Node.js 22 or newer; found $(node --version)." >&2
  exit 1
fi

npm ci
npm run build
npm prune --omit=dev
chown -R testagram:testagram "$ROOT"
systemctl daemon-reload
systemctl enable --now testagram-mail.service
