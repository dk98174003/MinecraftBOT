# Operations

## Target host

The current deployment is designed for the RPI5CM Minecraft host:

- Minecraft Java custom version: `26.2`
- Minecraft port: `25565`
- offline authentication
- Docker container: `minecraft`
- RCON port: `25575`
- Qwen OpenAI-compatible API: `http://192.168.0.65:8000/v1`

## First deployment

```bash
cd /data
git clone https://github.com/dk98174003/MinecraftBOT.git MinecraftBOT
cd MinecraftBOT

cp .env.example .env
./scripts/bootstrap.sh
npm start
```

The bootstrap script looks for the existing custom Mineflayer tarball at
`/data/minecraft-bot26/mf262.tgz`. You can also set `MINEFLAYER_FORK_TGZ`.

## systemd

Review `deploy/minecraftbot.service`, especially `WorkingDirectory`, then:

```bash
sudo cp deploy/minecraftbot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now minecraftbot.service
sudo systemctl status minecraftbot.service
```

Logs:

```bash
journalctl -u minecraftbot.service -f
```

Restart after pulling an update:

```bash
cd /data/MinecraftBOT
git pull
npm run check
sudo systemctl restart minecraftbot.service
```

## In-game control

Normal player chat is context for the autonomous agent.

Administrative commands:

```text
!ronja status
!ronja pause
!ronja start
```

Users allowed to pause/resume autonomy are configured with
`AGENT_ADMIN_USERS`.

## RCON password

Do not commit the password.

If `RCON_PASSWORD` is empty, the process reads the first `rcon.password=` entry
from the configured `RCON_PROPERTIES_PATHS`. Set `RCON_PASSWORD` in `.env` only
when automatic discovery is not possible.

## Health checks

LLM:

```bash
curl http://192.168.0.65:8000/v1/models
```

Minecraft process:

```bash
systemctl status minecraftbot.service
journalctl -u minecraftbot.service -n 100 --no-pager
```

## Protocol note

The custom Mineflayer 26.2 fork is still required to connect to the server.
This agent does not call `bot.placeBlock`, so the historical `block_place`
packet-mapper workaround is not part of the runtime path. If physical
inventory-based placement is added later, re-test the custom protocol mapping
before enabling it.
