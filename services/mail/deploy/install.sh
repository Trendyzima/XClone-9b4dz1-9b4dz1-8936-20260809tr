#!/usr/bin/env bash
set -euo pipefail
ROOT=/opt/testagram-mail
install -d -o testagram -g testagram "$ROOT"
npm ci --omit=dev
npm run build
chown -R testagram:testagram "$ROOT"
systemctl daemon-reload
systemctl enable --now testagram-mail.service
