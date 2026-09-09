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
      echo "Copying Minecraft 26.2 Mineflayer 4.37.1-based fork from $src"
      cp "$src" "$VENDOR"
      break
    fi
  done
fi

if [[ ! -f "$VENDOR" ]]; then
  cat >&2 <<'EOF'
ERROR: vendor/mf262.tgz is missing.

This server uses a custom Minecraft 26.2 fork based on Mineflayer 4.37.1.
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

# Fresh installs of the custom fork can restore an off-by-one minecraft-data
# tail. Patch the raw protocol document and then verify the vanilla-776
# invariants before Eva is allowed to start physical block placement.
npm run patch:protocol
npm run verify:protocol

npm run verify:mineflayer
npm run check
npm run test:protocol
npm run test:reference

echo
echo "Bootstrap complete."
echo "Copy .env.example to .env, review the values, then run: npm start"
