# MinecraftBOT

Kode og viden til Minecraft-setuppet på RPI5CM (192.168.0.219).

To separate systemer:

1. **`bot26/`** — Ronja: Mineflayer-bot (username `Ronja`) der render i spillet og svarer i chatten via LLM. Kører som systemd-service på RPI5CM fra `/data/minecraft-bot26/`.
2. **`rcon-agents/`** — RCON-byggeagenter (Python) der bygger strukturer server-side via `rcon-cli` (`fill`/`setblock`). Kører ad hoc på RPI5CM fra `/data/minecraft-bot/`.

## Server

- Minecraft Java **26.2** (custom "complexity"-server), Docker-container `minecraft` på RPI5CM.
- LAN-only, port 25565 (bot) / RCON 25575.
- `online-mode=false` (offline-mode, mineflayer logges ind med bare username).
- RCON-adgang: `grep ^rcon.password /data/server.properties` i containeren.

## bot26/ (Ronja)

- `mcbrain.js` — hovedfilen. Mineflayer-bot + LLM-loop:
  - Modtager chat fra spillere, sender til LLM (via API),
  - LLM kan kalde værktøjer: `make` (RCON setblock, op til 400 blokke), `tp`/`follow` (teleport via RCON), `clear`.
  - `spawnBot()` resawner ved kink/disconnect.
- `bot.js`, `chat.js`, `roofbot.js`, `test.js` — tidligere/eksperimentelle varianter.
- `package.json` — bruger **custom fork af mineflayer** (`4.37.1+complexity.26.2.3`), installeret fra `mf262.tgz` (ligger i `/data/minecraft-bot26/` på RPI5CM, ikke i repoet — 340 KB binary).
- Kører som systemd-service: `mcbrain.service` (root unit på RPI5CM). Restart: `sudo systemctl restart mcbrain.service`.

## rcon-agents/

- `castle_agent.py` — byggede slottet ved c(60,94,40) (y=100, tag y=102, tårne op til y=107).
- `mcdonalds.py` — McDonald's-byg.
- `castle_flat.py`, `castle_gen.py`, `castle_outer.py` — varianter/generators.
- `render_castle.py` — renderer slot til `castle.png`.
- Flow: Python → `docker exec minecraft rcon-cli --host 127.0.0.1 --port 25575 --password <pw> "fill ..."`.

## 26.2-fork: API-erfundinger (verificeret 2026-09-07)

Forken (`mineflayer 4.37.1+complexity.26.2.3`) adskiller sig fra vanilla mineflayer:

- **Block-positions er plain objects** `{x,y,z}` uden Vec3-metoder. `Vec3` er eksporterede og kan bruges til at pakke positioner.
- `bot.blockAt(x,y,z)` virker (sync), men `bot.findBlock(...)` kan returne null — brug `blockAt` på eksakte koordinater.
- **Bevægelse** (`setControlState`/`lookAt`/`moveState`): ✅ virker.
- **Digging** (`bot.dig(block, ...)`): ✅ virker — forudsætter at block-positionen er en `Vec3` (pak den: `Object.assign({}, block, {position: new Vec3(...)})`).
- **Equip** (`bot.equip(item)`): ✅ virker — item skal have `slot`-felt (tag det ud af `bot.inventory.slots`, `Object.assign({}, s, {slot: i})`).
- **Blokplacering**: ❌ forkens `bot.placeBlock()` sender det gamle `block_place`-pakket (forkert packet-ID → server decoder som `test_instance_block_action` og kikker).
  - Ny protokol (26.2) `block_place`-skema: `{hand, location{x,y,z}, direction, cursorX/Y/Z, insideBlock, worldBorderHit, sequence}`.
  - Raw `client.write("block_place", {...skemaet})` accepteres af serveren (ingen kick), men end-to-end placering er ikke verificeret — test med probe-script i `docs/probe-place.md`.
- Inventory: `bot.inventory.slots` (object, indekser som strings). Item-navne kan komme som `minecraft:stone` eller `stone`.
- `rcon-cli` syntax på RPI5CM: `rcon-cli --host 127.0.0.1 --port 25575 --password <pw> "<cmd>"` (ikke `-p`).

## Byggete (i verdenen)

- Slot: c(60,94,40), y=100–107.
- Pink dobbeltseng (Knud byggede den til botten): c(69-70,101,42-43).
- Monument/lantern-tower (70,20) y=99 — står permanent ("this is your world", 2026-09-06).

## Opsætning af bot26 fra bunden

1. `scp mf262.tgz` til mål (fra RPI5CM).
2. `npm install` derefter `npm install ./mf262.tgz` (fork erstatter mineflayer).
3. `systemctl start mcbrain.service`.
