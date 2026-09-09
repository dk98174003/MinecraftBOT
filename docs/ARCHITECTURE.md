# Architecture

Eva is split into planning, world-state, movement and physical action layers.

```text
Minecraft 26.2
     │
     │ custom Mineflayer 4.37.1-based fork
     ▼
 src/index.js
     │
     ├── chat/message events ──────────────┐
     │                                     │
     ▼                                     ▼
 src/world.js                        src/agent.js
 compact world snapshot             autonomous Qwen loop
                                           │
                     ┌─────────────────────┼──────────────────────┐
                     ▼                     ▼                      ▼
               src/llm.js           src/movement.js        src/building.js
               Qwen planner         real walking           physical placement
                                                               │
                                             equip item + bot.placeBlock
                                                               │
                                                               ▼
                                                        Minecraft world

RCON is side-channel support only:
- Creative-mode server policy
- optional /give material provisioning
- fallback tellraw if normal bot chat fails
```

## Planner contract

The model never receives arbitrary code execution. It receives a compact JSON
world snapshot and may return only whitelisted actions:

- `chat`
- `walk_to`
- `walk_to_player`
- `wander`
- `look_at_player`
- `jump`
- `build_house`
- `build_watchtower`
- `build_preset`
- `build_box`
- `build_shape`
- `remember`
- `wait`

`src/agent.js` validates and dispatches these actions.

## Embodied building

`src/building.js` is intentionally not a world-edit wrapper. The physical
placement pipeline is:

1. create a validated blueprint;
2. reject oversized/distant plans;
3. check the target block and avoid overwriting substantial existing blocks;
4. find an adjacent non-air reference block;
5. walk Eva into placement range;
6. obtain/equip the material;
7. call Mineflayer `bot.placeBlock(reference, face)`;
8. verify the target block appeared;
9. retry temporarily unsupported blocks in later passes.

The optional RCON provisioning path may execute `/give Eva <block> 64` when an
item is missing. It never executes `setblock` or `fill` for construction.

## Semantic structures

A semantic blueprint encodes architecture rather than asking the LLM to emit
hundreds of coordinates.

`build_house` creates:

- wood floor;
- hollow walls;
- centered two-block doorway;
- windows;
- corner posts;
- roof overhang;
- raised roof ridge;
- interior lighting.

`build_watchtower` creates a compact fortification tower with deck and
battlements.

Large solid boxes are rejected so a generic cuboid cannot accidentally become
a “house”.

## Autonomy

Player messages trigger an immediate planning cycle. Without messages, the
normal timer continues. The prompt asks Qwen to pursue useful physical actions
rather than generating random structures. If repeated idle plans contain no
movement/build action, the runtime injects a small wander action after the
configured idle-cycle threshold.

Only one build action is executed per planning cycle, preventing accidental
duplicate construction requests.

## Memory and feedback

`agent-memory.json` stores notes, player last-seen information and build records.
Build records include `mode: physical_mineflayer` and placement statistics.

Each action result is written to `lastActionResult` and fed back to Qwen. Build
status is also included in the world snapshot while a long physical build is in
progress.

## Failure model

A placement that cannot be confirmed is reported as failed. Unsupported targets
are retried in later passes. The builder tolerates a small number of local
failures, but aborts the semantic action when too much of the structure could
not be physically completed.

There is deliberately no hidden RCON construction fallback: protocol or
placement regressions remain visible and debuggable.
