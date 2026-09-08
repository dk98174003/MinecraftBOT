#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/vendor/mf262.tgz"

if [[ ! -f "$VENDOR" ]]; then
  candidates=(
    "${MINEFLAYER_FORK_TGZ:-}"
    "/data/minecraft-bot26/mf262.tgz"
    "/data/minecraft-bot/mf262.tgz"
  )

  for src in "${candidates[@]}"; do
    if [[ -n "$src" && -f "$src" ]]; then
      echo "Copying Minecraft 26.2 Mineflayer fork from $src"
      cp "$src" "$VENDOR"
      break
    fi
  done
fi

if [[ ! -f "$VENDOR" ]]; then
  cat >&2 <<'EOF'
ERROR: vendor/mf262.tgz is missing.

This server uses a custom Minecraft 26.2 Mineflayer fork.
Provide it using either:

  export MINEFLAYER_FORK_TGZ=/path/to/mf262.tgz
  ./scripts/bootstrap.sh

or copy it manually to:

  vendor/mf262.tgz
EOF
  exit 1
fi

cd "$ROOT"
npm install
npm run check

echo
echo "Bootstrap complete."
echo "Copy .env.example to .env, review the values, then run: npm start"
