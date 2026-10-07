#!/usr/bin/env bash
set -euo pipefail
ROOT=/opt/testagram-mail
cd "$ROOT"
npm install --omit=dev
npm run build
chown -R testagram:testagram "$ROOT"
systemctl daemon-reload
systemctl enable --now testagram-mail.service
