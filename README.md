# MinecraftBOT — Eva autonomous embodied AI

Eva is an autonomous female Minecraft character connected to the local Qwen
service. She has a real Mineflayer body: she walks, turns, chats, equips blocks,
and **physically places construction blocks herself**.

Qwen endpoint:

```text
http://192.168.0.65:8000/v1
```

Default model: `qwen38-27b`.

## Current design

The runtime intentionally separates thinking from acting:

1. `src/world.js` gives Qwen a compact snapshot of the visible world.
2. `src/agent.js` asks Qwen for a small JSON action plan.
3. `src/movement.js` moves Eva's actual Mineflayer avatar.
4. `src/building.js` converts approved structures into a block-placement plan.
5. Eva walks into reach, equips each material, and calls Mineflayer
   `placeBlock` for every block.
6. Results are fed back into the next Qwen planning cycle.

RCON is no longer a construction engine. It may still enforce Creative mode,
provide fallback `tellraw`, and optionally run `/give Eva ...` to provision
materials. There is no `setblock` or `fill` construction path in the builder.

## What Eva can do

- operate continuously without a human driver;
- listen and respond to normal player chat;
- physically walk toward coordinates or visible players;
- wander when she has been idle for too long;
- look at players and jump over simple obstacles;
- remember useful facts and recent builds across restarts;
- build physical platforms, walls and bridges;
- build a real cottage blueprint with floor, hollow walls, doorway, windows,
  structural corner trim, roof overhang, roof ridge and lighting;
- build a watchtower blueprint with doorway, windows, top deck and battlements;
- reject large solid cuboids so a request such as “build a house” cannot silently
  turn into a massive 7x7 stone cube;
- report movement or placement failures to Qwen and adapt on a later cycle;
- reconnect automatically after disconnects.

## Semantic building

For recognizable structures, Qwen is instructed to use semantic build actions
instead of trying to invent geometry from one giant box.

### House

`build_house` defaults to a 7x7 `stone_cottage` with wall height 3. Supported
styles are:

- `stone_cottage`
- `oak_cottage`
- `spruce_cottage`

The runtime keeps the interior hollow and reserves a centered two-block-high
doorway. A 7x7 default house currently contains 209 planned blocks.

### Watchtower

`build_watchtower` creates a compact castle/fortification tower with a floor,
hollow walls, doorway, windows, deck, battlements and light.

### Generic boxes

`build_box` remains available for construction primitives such as a floor,
foundation, beam, short wall segment or hollow room. Large solid 3-D boxes are
rejected by the runtime.

## Physical placement behavior

Before placing a block Eva:

- checks that the target is empty or only contains safe vegetation;
- refuses to overwrite substantial existing blocks;
- finds a real neighboring reference block;
- walks into Mineflayer placement range;
- equips the requested material in her hand;
- calls `bot.placeBlock(...)`;
- verifies that the expected block appeared in the world.

Unsupported blocks are retried in later placement passes so roofs and other
parts can use blocks placed earlier in the same build as support.

For semantic houses/towers Eva also chooses a nearby reasonably flat site when
an explicit origin was not supplied.

## Minecraft 26.2 protocol status

The old automatic `vanilla-776` protocol patch has been disabled because it was
based on Minecraft 26.1 data, not the actual 26.2 server registry. Bootstrap now
leaves installed `minecraft-data` untouched.

The authoritative 26.2 server binary shows `USE_ITEM_ON` (block placement) at
wire `0x40`, followed by `USE_ITEM` at `0x41` and `CUSTOM_CLICK_ACTION` at
`0x42`. The exact Prismarine packet names and the two phantom entries in the
pristine fork mapper are still being reconciled against that server registry.

Use the read-only mapper dumper to inspect the installed fork without modifying
it:

```bash
npm run dump:protocol -- --json
```

See `docs/OPERATIONS.md` for the confirmed tail and protocol-debugging workflow.

## Safety boundaries

Qwen cannot execute shell commands or arbitrary JavaScript. It can only choose
from the action contract enforced in `src/agent.js`.

Guardrails include:

- no attack/grief/destructive world-edit action exposed to Qwen;
- building block whitelist;
- maximum build size and distance;
- refusal to overwrite substantial existing blocks;
- refusal of large solid cuboids;
- movement time/drop safety limits;
- administrative pause/resume restrictions.

## Repository layout

```text
src/
  index.js       Minecraft connection, events, reconnect
  agent.js       autonomous planning loop and action dispatcher
  llm.js         Qwen/OpenAI-compatible API client
  world.js       compact Minecraft world snapshot
  movement.js    embodied walking/jump/navigation primitives
  building.js    physical Mineflayer builder + semantic blueprints
  rcon.js        server administration / provisioning helper
  memory.js      persistent local memory

scripts/
  bootstrap.sh             installs the custom 26.2 Mineflayer fork + dependencies
  dump-play-protocol.js    read-only play-serverbound mapper/schema diagnostic
  test-blueprints.js       verifies semantic house/tower geometry
  test-protocol-dump.js    verifies protocol-dump parsing without modifying data
  test-reference-policy.js verifies safe placement-reference selection

deploy/
  minecraftbot.service

docs/
  ARCHITECTURE.md
  OPERATIONS.md
```

## Requirements

- Node.js 20+
- Mineflayer **4.37.1-based** custom Minecraft 26.2 fork
- Minecraft server on port 25565
- Qwen endpoint reachable at `192.168.0.65:8000`
- RCON recommended for Creative-mode policy and automatic material provisioning

The physical builder depends on the custom fork's `bot.placeBlock` path. If the
26.2 protocol mapping is wrong, the builder reports the failure; it does **not**
silently fall back to `setblock`.

## Install on RPI5CM

```bash
git clone https://github.com/dk98174003/MinecraftBOT.git
cd MinecraftBOT
cp .env.example .env
./scripts/bootstrap.sh
npm run check
npm run test:blueprints
npm start
```

`bootstrap.sh` looks for the custom fork at:

```text
/data/minecraft-bot26/mf262.tgz
```

or use:

```bash
export MINEFLAYER_FORK_TGZ=/path/to/mf262.tgz
./scripts/bootstrap.sh
```

## In-game control

With `MC_USERNAME=Eva`:

```text
!eva status
!eva pause
!eva start
```

Players can just talk normally:

```text
Eva, kom herover.
Byg et lille hus her.
Kan du hjælpe med et vagttårn til slottet?
Gå en tur rundt i gården og se hvad der mangler.
```

`!eva status` includes physical build progress while a build is active.

## Configuration

See `.env.example`. Important building settings include:

```dotenv
BUILD_MAX_BLOCKS=1200
BUILD_MAX_DISTANCE=48
BUILD_REACH=4.2
BUILD_PLACEMENT_DELAY_MS=90
BUILD_RCON_PROVISION=true
```

`BUILD_RCON_PROVISION=true` permits only material provisioning through RCON.
Construction still happens through Eva's Mineflayer body.

Do not commit RCON passwords. If `RCON_PASSWORD` is blank, the process searches
configured `server.properties` paths for `rcon.password`.

## More documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Operations and deployment](docs/OPERATIONS.md)
