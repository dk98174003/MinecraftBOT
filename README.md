# MinecraftBOT — Ronja autonomous AI agent

Ronja is an autonomous female Minecraft character that lives inside the
Minecraft world, walks around with a real Mineflayer body, talks to players,
remembers useful facts, and builds structures.

Her planner is the local Qwen service at:

```text
http://192.168.0.65:8000/v1
```

The default model is `qwen38-27b`, configurable in `.env`.

## What changed

This repository is now one coherent agent rather than a collection of
experimental bots and one-off RCON build scripts.

The old `bot26/` experiments and `rcon-agents/` utilities were removed from the
current tree. Their history remains available in Git if an old build script ever
needs to be recovered.

## Capabilities

Ronja can:

- operate continuously without a human driver;
- listen to normal player chat and decide when to respond;
- physically walk toward coordinates or visible players;
- wander and explore autonomously;
- look at players and jump over simple obstacles;
- use persistent local memory across restarts;
- build small platforms, walls, towers, huts, bridges, and LLM-defined shapes;
- report action failures back to Qwen and adapt on the next planning cycle;
- reconnect automatically after disconnects.

Building uses RCON because it is the most reliable construction path on the
custom Minecraft 26.2 server. Normal movement is not teleport-based: the
Mineflayer avatar actually walks.

## Safety boundaries

Qwen is **not** allowed to execute shell commands or arbitrary JavaScript.
It chooses from a fixed action contract enforced by `src/agent.js`.

Additional guardrails include:

- no destructive/griefing action exposed to the model;
- build block whitelist;
- maximum build size;
- builds must be close to Ronja's physical position;
- movement has per-action time and drop-safety limits;
- administrative pause/resume commands can be restricted to named users.

## Repository layout

```text
src/
  index.js       Minecraft connection, events, reconnect
  agent.js       autonomous planning loop and action dispatcher
  llm.js         Qwen/OpenAI-compatible API client
  world.js       compact Minecraft world snapshot
  movement.js    embodied walking/jump/navigation primitives
  building.js    guarded RCON builder and presets
  rcon.js        safe docker/rcon-cli wrapper
  memory.js      persistent local memory

scripts/
  bootstrap.sh   installs the custom 26.2 Mineflayer fork + dependencies

deploy/
  minecraftbot.service

docs/
  ARCHITECTURE.md
  OPERATIONS.md
```

## Requirements

- Node.js 20+
- **Mineflayer 4.37.1**, using the custom Minecraft 26.2 fork (`mf262.tgz`)
- Minecraft server reachable on port 25565
- Docker/RCON access on the Minecraft host for chat/build actions
- Qwen endpoint reachable at `192.168.0.65:8000`

The custom package may report a build-metadata version such as `4.37.1+...`;
that is still a Mineflayer 4.37.1-based build. `scripts/bootstrap.sh` verifies
this after installation so an incompatible Mineflayer release is not used by
mistake.

The current server is offline-mode, so the default username is `Ronja` with
`MC_AUTH=offline`.

## Install on RPI5CM

```bash
git clone https://github.com/dk98174003/MinecraftBOT.git
cd MinecraftBOT

cp .env.example .env
./scripts/bootstrap.sh
npm start
```

`bootstrap.sh` automatically looks for the existing custom fork at:

```text
/data/minecraft-bot26/mf262.tgz
```

You can instead point to another copy:

```bash
export MINEFLAYER_FORK_TGZ=/path/to/mf262.tgz
./scripts/bootstrap.sh
```

## Configuration

Important defaults in `.env.example`:

```dotenv
MC_HOST=127.0.0.1
MC_PORT=25565
MC_USERNAME=Ronja
MC_AUTH=offline
MC_VERSION=26.2

LLM_BASE_URL=http://192.168.0.65:8000/v1
LLM_MODEL=qwen38-27b
LLM_API_KEY=EMPTY

AGENT_AUTONOMOUS=true
AGENT_TICK_MS=5000
AGENT_ADMIN_USERS=dk98174003

RCON_ENABLED=true
RCON_CONTAINER=minecraft
RCON_HOST=127.0.0.1
RCON_PORT=25575
```

Do not put passwords in Git. If `RCON_PASSWORD` is blank, the process searches
the known `server.properties` locations for `rcon.password`.

## How autonomy works

Every planning cycle Ronja gives Qwen a compact state containing:

- position, health, food, time, and weather;
- nearby visible players;
- inventory summary;
- nearby block information;
- recent player messages;
- persistent notes and recent builds;
- her current goal;
- the concrete result of her previous action.

Qwen returns a JSON plan of at most a few actions. The runtime validates and
executes them, then the result becomes input to the next cycle.

Player messages accelerate the next planning cycle, but Ronja does not depend on
messages to act. When nobody is talking, she can still wander, build, or pursue
her own current goal.

## In-game commands

```text
!ronja status
!ronja pause
!ronja start
```

Normal interaction requires no command. Players can simply talk to Ronja:

```text
Ronja, come over here.
Can you build a small tower beside me?
What are you doing?
Go explore the courtyard.
```

## Character / girl skin

The AI persona is Ronja. The visible Minecraft skin is controlled separately by
the account/server skin mechanism. On this offline-mode server, keep the
username `Ronja` and assign the desired girl skin through the server-side skin
setup.

## More documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Operations and deployment](docs/OPERATIONS.md)
