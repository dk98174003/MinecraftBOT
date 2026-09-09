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

Physical construction now requires the custom fork's Mineflayer
`bot.placeBlock` path. This was deliberately changed from the old RCON builder.

If you see repeated errors such as:

```text
Mineflayer placeBlock API is unavailable
placement was not confirmed as <material>
```

or protocol packet errors immediately when placement starts, verify the custom
26.2 Mineflayer packet mapping. Do not re-enable `setblock` as a silent fallback;
it would make Eva appear stationary again and hide the protocol defect.

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
