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

# Minecraft 26.2 protocol 776 has 69 play-serverbound registrations. The
# pristine fork is missing teleport_to_entity at wire 0x40, which shifts the
# tail and incorrectly emits block_place at 0x41. Apply the exact-signature,
# idempotent correction after install so block_place/use_item_on is 0x42.
npm run patch:26.2-protocol
npm run verify:mineflayer
npm run check
npm test

echo
echo "Bootstrap complete."
echo "Minecraft 26.2 protocol tail correction was validated: block_place/use_item_on=0x42."
echo "Use 'npm run dump:protocol -- --json' to inspect the installed play-serverbound mapper."
echo "Copy .env.example to .env, review the values, then run: npm start"
