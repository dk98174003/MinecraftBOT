# Architecture

Ronja is deliberately split into a small set of components instead of one large script.

```text
Minecraft 26.2
     │
     │ Mineflayer custom fork
     ▼
 src/index.js
     │
     ├── chat/message events ─────────────┐
     │                                    │
     ▼                                    ▼
 src/world.js                       src/agent.js
  world snapshot                    autonomous loop
                                          │
                    ┌─────────────────────┼───────────────────┐
                    ▼                     ▼                   ▼
              src/llm.js           src/movement.js      src/building.js
              Qwen planner         real walking          RCON builds
                    │                                         │
                    ▼                                         ▼
      192.168.0.65:8000/v1                         docker rcon-cli
```

## Planner contract

The LLM never receives arbitrary code execution. It receives a compact JSON world
snapshot and may return only whitelisted actions:

- `chat`
- `walk_to`
- `walk_to_player`
- `wander`
- `look_at_player`
- `jump`
- `build_preset`
- `build_shape`
- `remember`
- `wait`

`src/agent.js` validates the action type before dispatching it.

## Why movement and building use different mechanisms

The avatar moves using Mineflayer control states, so Ronja actually walks through
the world instead of being teleported for normal navigation.

Building uses RCON `setblock` commands. This is intentional for this particular
Minecraft 26.2 server: the custom protocol fork has historically required a
packet-mapping patch for `placeBlock`, while RCON building is reliable. The
builder is constrained by a block whitelist, maximum block count, and maximum
distance from Ronja's current body.

## Memory

`agent-memory.json` stores small persistent facts, player last-seen information,
and build records. It is intentionally local and is ignored by Git.

## Failure model

Each action returns a concrete result. Failed actions are recorded in
`lastActionResult` and fed back to Qwen on the next cycle. Ronja is instructed
not to claim success until the action layer reports success.
