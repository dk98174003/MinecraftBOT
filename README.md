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

## bot26/ (Ronja) — AI-meldingstræk (hvordan messagerne virker)

Arkitektur i `mcbrain.js` (verificeret mod live-serveren 2026-09-07):

```
Spiller-Chat ──▶ mineflayer "message"/"chat" ──▶ handleUser()
                                                    │
                       ┌────────────────────────────┤
                       ▼ (regex-match)              ▼
             Deterministisk "follow"        askLLM() → qwen38-27b
             RCON `execute as @s`          (OpenAI-compatible,
             tp Ronja ~ ~ ~                 gx10 192.168.0.65:8000/v1)
                                                    │
                                                    ▼
                                        parseTool(): [[TOOL: {...}]]-linje
                                        + stripTool() (ren tekst)
                                                    │
                              ┌─────────────────────┤
                              ▼ (værktøj)           ▼ (ingen)
                       runTool() (RCON)          say() = RCON tellraw
                              │
                              ▼
                       2. LLM-turn: bekræft resultat
                              │
                              ▼
                          say() → tellraw @a
```

Vigtige detaljer:

1. **Chat-opsamling**: mineflayer `bot.on("message", onChat)` og `bot.on("chat", onChat)` (26.2 bruger `message`). 3. argument er en UUID; spillernavnet er `<Name>`-prefixet i strengen. Regex `^<([^>]+)> ?(.*)$` splitter displayname fra payload.
2. **Filtering af systembeskeder**: beskeder der starter med `[` eller `!` ignoreres (vores egne `tp`/`tellraw`, join-messages).
3. **Debounce**: `SAY_DEBOUNCE = 5000` ms pr. bruger — undgår spam-loop.
4. **Deterministisk "follow" før LLM**: regex `FOLLOW_RE` matcher "come to me / follow / meet me / kom til mig / ..." og udfører straks `execute as @a[name=<user>] at @s run tp Ronja ~ ~ ~` uden at spørge LLM'en. Besvarer med "Kommer med det samme — på vejen til dig."
5. **LLM-call**: `fetch(LLM_BASE + "/chat/completions")`, `Authorization: Bearer <randomUUID>` (gx10'ets gateway ignorerer tokenet). `temperature: 0.7, max_tokens: 400`. Historik: ringbuffert op til 16 beskedter.
6. **Værktøjskontrakt**: LLM'en skal afslutte med en linje `[[TOOL: {...}]]` (senst i beskeden vinder). `parseTool()` finder dem, `stripTool()` fjerner dem fra den synlige tekst. Værktøjer: `tp`, `follow`, `make` (op til 400 blokke, hvitlister af blokke, partiet 40 RCON-batcher), `clear`. Maks 1 værktøj pr. besked.
7. **Svar-kanal = RCON `tellraw`, IKKE bot-chat**: klienten forlader botten usignede `[Not Secure]`-chat, så alle svar går via `tellraw @a [aqua "Ronja: ", tekst]` (system-chat, vises altid).
8. **Værktøjsbekræftelse**: efter `runTool()` kaldes LLM'en igen med system-besked "Tool result: ..." + user "Confirm to the user what just happened, one short sentence" → den korte bekræftelse sendes via `say()`.
9. **Spawns/reconnect**: `spawnBot()` resawner ved `end` efter 5s; parkerer ved nordøst-tårnet (54,108,34) så brugeren kan finde botten.

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
- **Blokplacering**: ✅ **FIXET 2026-09-07** — `bot.placeBlock(referenceBlock, faceVector)` virker nu end-to-end mod vanilla 26.2.
  - **Årsag**: forkens 26.2 `toServer`-mapper i `minecraft-data` var forskyvet med 1 i halen (mangled `teleport_to_entity` @ 0x40, og `spectate`/`swing` var byttet om) → `block_place` blev sendt som **0x41**, som serveren decoder som `test_instance_block_action` → decode-kick.
  - **Fix** (i data-laget, IKKE i `mineflayer/lib/plugins/generic_place.js`): omskrevet `play.toServer.types.mapper`-halen i `node_modules/minecraft-data/minecraft-data/data/pc/26.2/protocol.json` til vanilla protocol 776:
    ```
    0x3e spectator_action
    0x3f arm_animation
    0x40 teleport_to_entity
    0x41 test_instance_block_action
    0x42 block_place   (USE_ITEM_ON)
    0x43 use_item
    0x44 custom_click_action
    ```
    + to tilføjte type-schemaer (`teleport_to_entity` = uuid; `custom_click_action` = identifier + nbt).
  - Backup: `protocol.json.preplacefix-` (samme mappe).
  - **Opmærksomhed**: 2. argument er en **retnings-Vec3** (faceVector), IKKE destination: `dest = referenceBlock.position + faceVector`. Fx. for at placere i +x-retning: `bot.placeBlock(support, new Vec3(1,0,0))`.
  - Verificeret live: `block_place` serialiserer nu med leading varint **0x42**, og et probe-script vendte et air-slot til stone på den rigtige server.
- Inventory: `bot.inventory.slots` (object, indekser som strings). Item-navne kan komme som `minecraft:stone` eller `stone`.
- `rcon-cli` syntax på RPI5CM: `rcon-cli --host 127.0.0.1 --port 25575 --password <pw> "<cmd>"` (ikke `-p`).

## Byggete (i verdenen)

- Slot: c(60,94,40), y=100–107.
- Pink dobbeltseng (Knud byggede den til botten): c(69-70,101,42-43).
- Monument/lantern-tower (70,20) y=99 — står permanent ("this is your world", 2026-09-06).

## Opsætning af bot26 fra bunden

1. `scp mf262.tgz` til mål (fra RPI5CM).
2. `npm install` derefter `npm install ./mf262.tgz` (fork erstatter mineflayer).
3. **Gentag `placeBlock`-packet-ID-fixet** (se ovenfor): efter en frisk install er
   `minecraft-data/.../pc/26.2/protocol.json` igen forskyvet i halen. Genskriv
   `play.toServer.types.mapper` til vanilla 776-halen (0x41/0x42/0x43/0x44) + tilføj
   `teleport_to_entity`/`custom_click_action`-schemaer — ellers giver
   `bot.placeBlock()` decode-kick.
4. `systemctl start mcbrain.service`.
