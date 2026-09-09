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

`bootstrap.sh` now reapplies and verifies the vanilla-776 minecraft-data tail
after every fresh `npm install`. A reinstall of the custom fork must therefore
not silently restore the known off-by-one `block_place` mapping.

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

## Protocol validation

Physical construction requires the custom fork's Mineflayer `bot.placeBlock`
path. The repository now encodes the known vanilla-776 invariants for the raw
minecraft-data document:

```text
0x3f arm_animation
0x40 spectate
0x41 test_instance_block_action
0x42 block_place
0x43 use_item
0x44 custom_click_action
```

The `packet_common_custom_click_action` schema must also remain:

```text
id  = string
nbt = optional anonymous NBT
```

Apply and verify the installed data manually with:

```bash
npm run patch:protocol
npm run verify:protocol
npm run test:protocol
```

The patcher understands the raw document root used on disk and is idempotent. It
also supports the older wrapper shape defensively, but it fails loudly if the
packet tail or `custom_click_action` schema is neither the known broken form nor
the known vanilla-776 form.

If auto-discovery cannot locate the exact installed file, set it explicitly:

```bash
MINECRAFT_DATA_PROTOCOL_JSON=/absolute/path/to/protocol.json npm run patch:protocol
```

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
