# Operations

## Target host

- Minecraft Java custom version: `26.2`
- Mineflayer base version: `4.37.1` using the custom 26.2 fork
- Minecraft port: `25565`
- offline authentication
- Docker container: `minecraft`
- RCON port: `25575`
- Qwen OpenAI-compatible API: `http://192.168.0.65:8000/v1`

## Deploy / update

```bash
cd /data/MinecraftBOT
git pull
./scripts/bootstrap.sh
npm run check
npm run test:blueprints
sudo systemctl restart minecraftbot.service
sudo systemctl status minecraftbot.service
```

`bootstrap.sh` deliberately leaves installed `minecraft-data` protocol files
untouched. The previous automatic `vanilla-776` patch was based on Minecraft
26.1 data and must not be applied to the 26.2 server.

Logs:

```bash
journalctl -u minecraftbot.service -f
```

## In-game control

With `MC_USERNAME=Eva`:

```text
!eva status
!eva pause
!eva start
```

`!eva status` reports the current autonomous goal and active physical build
progress.

## Physical builder verification

After deployment, test on an empty flat Creative area with a simple request:

```text
Eva, byg et lille 7x7 hus her.
```

Expected behavior:

1. Eva acknowledges the player.
2. Eva moves around the build area.
3. Blocks appear one at a time from Eva's client rather than instantly through
   world-edit commands.
4. The result has a wooden floor, hollow interior, doorway, windows and roof.
5. Logs show `[builder]` placement details only on skips/failures.

A successful default house uses 209 planned blocks. Use `!eva status` during the
build to see progress.

## Placement reference policy

Eva must place against a real structural reference block. The physical builder
rejects `leaf_litter`, grass/fern decorations, carpet, rails, torches, snow
layers, buttons, pressure plates and other thin shapes as placement anchors.
Collision geometry is also checked so a nominally non-air decorative block does
not become the reference for `bot.placeBlock()`.

For protocol isolation tests, use a target air block directly above a normal
stone, cobblestone, dirt or grass block.

## RCON role

RCON remains enabled for:

- setting default/online players to Creative mode;
- optional material provisioning with `/give Eva ...`;
- fallback styled chat if `bot.chat` fails.

The physical builder must never use `setblock` or `fill`. `BUILD_RCON_PROVISION`
controls only the `/give` behavior.

To disable material provisioning:

```dotenv
BUILD_RCON_PROVISION=false
```

When disabled, Eva must already have the required blocks in inventory.

## Building tuning

Useful settings:

```dotenv
BUILD_MAX_BLOCKS=1200
BUILD_MAX_DISTANCE=48
BUILD_REACH=4.2
BUILD_MOVE_RANGE=1.1
BUILD_MOVE_MAX_SECONDS=8
BUILD_PLACEMENT_DELAY_MS=90
BUILD_MAX_PLACEMENT_PASSES=5
BUILD_MIN_SITE_SCORE=0.72
```

If the server needs more time to confirm placements, increase
`BUILD_PLACEMENT_DELAY_MS` to e.g. `150` or `200` before changing other logic.

If Eva cannot reach targets because the custom server has a slightly different
interaction distance, tune `BUILD_REACH` conservatively. The configured range is
also checked against actual post-walk distance before placement.

## Minecraft 26.2 protocol validation

The authoritative Minecraft 26.2 play-state serverbound registry was extracted
from the actual server binary, including the interleaved common packet types.
Its confirmed decimal/hex tail is:

```text
54 0x36 SET_CREATIVE_MODE_SLOT
55 0x37 SET_GAME_RULE
56 0x38 SET_JIGSAW_BLOCK
57 0x39 SET_STRUCTURE_BLOCK
58 0x3a SET_TEST_BLOCK
59 0x3b SIGN_UPDATE
60 0x3c SPECTATOR_ACTION
61 0x3d SWING
62 0x3e TELEPORT_TO_ENTITY
63 0x3f TEST_INSTANCE_BLOCK_ACTION
64 0x40 USE_ITEM_ON
65 0x41 USE_ITEM
66 0x42 CUSTOM_CLICK_ACTION
```

`USE_ITEM_ON` is the server packet used for block placement and is wire ID
`0x40` in 26.2. Do not reuse the Minecraft 26.1/vanilla-776 tail where
`block_place` was assumed to be `0x42`.

Mojang server packet names and Prismarine internal packet names are not always
identical. For example, Mineflayer may still call the internal packet
`block_place` while its protocol mapper assigns it to the server's `USE_ITEM_ON`
wire slot. Therefore the exact pristine 26.2 mapper and schema must be inspected
before changing Mineflayer code.

### Dump the installed pristine mapper

The repository includes a read-only diagnostic tool. It never modifies
`protocol.json`:

```bash
npm run dump:protocol
```

For machine-readable output suitable for comparing with the decompiled server
registry:

```bash
npm run dump:protocol -- --json
```

To inspect one known pristine protocol file directly:

```bash
npm run dump:protocol -- /absolute/path/to/protocol.json
```

or:

```bash
MINECRAFT_DATA_PROTOCOL_JSON=/absolute/path/to/protocol.json npm run dump:protocol -- --json
```

The dump includes the complete `play.toServer` mapper, decimal and hexadecimal
wire IDs, the params type for each packet, and focused schemas for the tail and
for `block_place`, `use_item`, and `custom_click_action` when present.

The next protocol task is to compare that complete pristine mapper with the
67-entry server registry, identify the two phantom entries before the tail, and
then construct a corrected 26.2 mapper. The real 26.2 `UseItemOn` payload schema
and server handler must also be derived from the 26.2 server decompilation before
we alter `_genericPlace()` or introduce any packet compatibility shim.

Do not re-enable `setblock` as a silent fallback; that would make Eva appear
stationary again and hide a protocol defect.

Mineflayer package check:

```bash
npm run verify:mineflayer
```

## LLM health

```bash
curl http://192.168.0.65:8000/v1/models
```

## RCON password

Do not commit the password. If `RCON_PASSWORD` is empty, the process checks
configured `RCON_PROPERTIES_PATHS` for `rcon.password=`.
