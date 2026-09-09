const { worldState } = require('./world')
const { sleep } = require('./movement')

function cleanText (value, limit = 300) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

class AutonomousAgent {
  constructor ({ bot, config, llm, rcon, movement, builder, memory }) {
    this.bot = bot
    this.config = config
    this.llm = llm
    this.rcon = rcon
    this.movement = movement
    this.builder = builder
    this.memory = memory

    this.enabled = config.agent.autonomous
    this.busy = false
    this.timer = null
    this.chat = []
    this.pendingReplies = []
    this.cycleRequested = false
    this.lastAction = 'spawned'
    this.goal = 'Stay useful: move through the world, help nearby players, and improve places carefully when there is a clear purpose.'
    this.seenMessages = new Map()
    this.idleCycles = 0
  }

  systemPrompt () {
    const name = this.bot.username || this.config.mc.username || 'Eva'
    return `You are ${name}, an autonomous female AI character physically embodied in a Minecraft Java 26.2 world.
Your brain is a local Qwen model, but speak and act as ${name}, a character inside Minecraft, not as a text assistant.

Embodiment is mandatory:
- Your body must visibly do the work. Walking uses Mineflayer controls and building uses Mineflayer block placement.
- Never assume RCON teleports or builds for you. RCON may only support server administration, styled fallback chat, or put materials into your inventory.
- When building, the runtime walks you around the site, equips the material in your hand, and places each block through the Minecraft client.
- Prefer walking to the player/site before helping. Do not stand still for repeated idle cycles unless there is a concrete reason.

Behavior:
- Friendly, curious, practical, independent, and concise.
- Respond in the player's language. Danish is common, but follow the language actually used.
- When state.replyRequired is present, answering that player is your highest priority. Include a chat action that directly responds to their message before optional movement or building actions.
- Never silently ignore state.replyRequired. Normal background conversation may be ignored only when replyRequired is null.
- Do not spam chat.
- Do not grief, destroy player structures, clear inventories, attack players, or modify distant areas.
- If a movement/build action fails, read lastActionResult and adapt instead of pretending it succeeded.
- Stay alive: avoid unsafe drops and do not deliberately enter lava or dangerous water routes.
- Use memory for facts worth keeping across restarts.
- Maximum ${this.config.agent.maxActions} actions per cycle.

Autonomy strategy:
- If nobody needs a reply and you have no active build, do something physically useful: walk toward a relevant player, explore a nearby area, return toward a useful location, or continue a clear goal.
- Do not create random buildings just to appear busy. Build when a player asks, when your current goal clearly calls for it, or when the structure solves an obvious local need.
- For help requests, acknowledge briefly, move to the requested area/player if needed, then act.

Building rules:
- For a HOUSE, always use build_house. Do NOT approximate a house with one large build_box.
- build_house creates an actual architectural blueprint: wood floor, hollow walls, centered two-block doorway, glass windows, corner trim, overhanging roof, roof ridge, and interior lanterns.
- Good default house size is 7x7 with wallHeight=3. Use 9x7 for a larger home. Keep dimensions odd so doors/windows remain symmetric.
- For a CASTLE or fortification task, use build_watchtower for a real tower, and simple hollow boxes/walls only for individual wall segments or foundations.
- build_watchtower creates a floor, hollow stone walls, doorway, windows, top deck, battlements, and lighting.
- build_box is a construction primitive, not a complete design. Use it for floors (height=1), short wall segments, foundations, beams, or hollow rooms. Large solid cuboids are rejected by the runtime.
- build_shape is only for small irregular details.
- The builder will refuse to overwrite substantial existing blocks. If a site is obstructed or uneven, walk to a better nearby site rather than forcing the build.
- A semantic build may take time because every block is physically placed. One build action is enough; do not duplicate it in the same cycle.

Return exactly one JSON object and no prose:
{
  "thought": "brief private planning summary",
  "goal": "current short goal",
  "actions": [
    {"type":"chat","message":"short Minecraft message"},
    {"type":"walk_to","x":0,"y":100,"z":0,"range":2},
    {"type":"walk_to_player","player":"PlayerName","range":2},
    {"type":"wander","radius":10},
    {"type":"look_at_player","player":"PlayerName"},
    {"type":"jump"},
    {"type":"build_house","style":"stone_cottage|oak_cottage|spruce_cottage","width":7,"depth":7,"wallHeight":3,"front":"north|south|east|west","origin":{"x":0,"y":100,"z":0}},
    {"type":"build_watchtower","size":7,"wallHeight":3,"origin":{"x":0,"y":100,"z":0}},
    {"type":"build_preset","name":"platform|wall|tower|hut|bridge","material":"cobblestone","origin":{"x":0,"y":100,"z":0}},
    {"type":"build_box","material":"stone_bricks","origin":{"x":0,"y":100,"z":0},"width":7,"height":1,"depth":7,"hollow":false},
    {"type":"build_shape","material":"stone_bricks","origin":{"x":0,"y":100,"z":0},"blocks":[[0,0,0],[1,0,0]]},
    {"type":"remember","note":"fact worth retaining"},
    {"type":"wait","seconds":2}
  ]
}

Omit origin on build_house/build_watchtower to let the runtime choose the best nearby flat site. Omit origin on simple builds to build beside your current position.`
  }

  start () {
    if (this.timer) return
    this.timer = setInterval(() => this.cycle(), this.config.agent.tickMs)
    setTimeout(() => this.cycle(), 600)
  }

  stop () {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.cycleRequested = false
    this.movement.stop()
  }

  requestCycle () {
    this.cycleRequested = true
    setTimeout(() => this.cycle(), 50)
  }

  canAdmin (username) {
    return this.config.agent.admins.size === 0 || this.config.agent.admins.has(username)
  }

  addChat (username, message, source = 'chat') {
    const text = cleanText(message, 400)
    if (!text || username === this.bot.username) return false

    const signature = `${username}|${text}`
    const now = Date.now()
    const last = this.seenMessages.get(signature) || 0
    this.seenMessages.set(signature, now)
    if (now - last < 800) return false

    const item = { username, message: text, source, at: new Date().toISOString() }
    this.chat.push(item)
    this.chat = this.chat.slice(-this.config.agent.maxHistory)
    this.pendingReplies.push(item)
    this.pendingReplies = this.pendingReplies.slice(-10)
    this.memory.rememberPlayer(username, text)
    return true
  }

  async say (message) {
    const clean = cleanText(message, 240)
    if (!clean) return 'empty chat message'

    if (typeof this.bot.chat === 'function') {
      try {
        this.bot.chat(clean)
        return `said in Minecraft chat: ${clean}`
      } catch (error) {
        console.warn('[agent] bot.chat failed, trying RCON fallback:', cleanText(error.message, 200))
      }
    }

    this.rcon.say(this.bot.username || this.config.mc.username || 'Eva', clean)
    return `said through RCON fallback: ${clean}`
  }

  async command (username, message) {
    const text = cleanText(message).toLowerCase()
    const commandPrefix = `!${String(this.bot.username || this.config.mc.username || 'Eva').toLowerCase()}`
    if (!text.startsWith(commandPrefix)) return false

    const command = text.split(/\s+/)[1] || 'status'
    if (command === 'status') {
      const build = this.builder.status()
      const buildText = build ? ` | build ${build.kind}: ${build.done ?? build.placed ?? 0}/${build.total ?? '?'}` : ''
      await this.say(`auto=${this.enabled ? 'on' : 'off'} | goal: ${this.goal}${buildText}`)
      return true
    }

    if (!this.canAdmin(username)) {
      await this.say(`${username}, only configured admins can change autonomous mode.`)
      return true
    }

    if (command === 'pause' || command === 'stop') {
      this.enabled = false
      this.movement.stop()
      await this.say('Autonomous mode paused.')
      return true
    }

    if (command === 'start' || command === 'resume') {
      this.enabled = true
      await this.say('Autonomous mode resumed.')
      this.requestCycle()
      return true
    }

    await this.say(`Commands: ${commandPrefix} status | ${commandPrefix} pause | ${commandPrefix} start`)
    return true
  }

  state () {
    return worldState(this.bot, {
      currentGoal: this.goal,
      lastActionResult: this.lastAction,
      currentBuild: this.builder.status(),
      recentChat: this.chat.slice(-14),
      replyRequired: this.pendingReplies[0] || null,
      pendingReplyCount: this.pendingReplies.length,
      memory: this.memory.context(),
      homePosition: this.config.agent.home,
      capabilities: {
        walking: true,
        chat: true,
        autonomous: true,
        building: true,
        buildMode: 'physical_mineflayer',
        rconPlacesBlocks: false,
        rconMayProvisionInventory: this.config.build.provisionWithRcon && this.config.rcon.enabled,
        semanticBuilds: ['house', 'watchtower'],
        buildPresets: ['platform', 'wall', 'tower', 'hut', 'bridge'],
        buildPrimitives: ['box', 'shape'],
        maxBuildBlocks: this.config.build.maxBlocks,
        maxBuildDistance: this.config.build.maxDistance
      }
    })
  }

  async perform (action) {
    const type = action?.type

    switch (type) {
      case 'chat':
        return this.say(action.message)

      case 'walk_to':
        return this.movement.walkTo({ x: action.x, y: action.y, z: action.z }, action.range)

      case 'walk_to_player':
        return this.movement.walkToPlayer(cleanText(action.player, 64), action.range)

      case 'wander':
        return this.movement.wander(action.radius)

      case 'look_at_player': {
        const name = cleanText(action.player, 64)
        const entity = this.bot.players?.[name]?.entity
        if (!entity?.position) throw new Error(`player ${name} is not visible`)
        await this.movement.lookAtPoint(entity.position)
        return `looked at ${name}`
      }

      case 'jump':
        return this.movement.jump()

      case 'build_house':
        return this.builder.buildHouse({
          origin: action.origin || null,
          style: cleanText(action.style, 40).toLowerCase() || 'stone_cottage',
          width: action.width ?? 7,
          depth: action.depth ?? 7,
          wallHeight: action.wallHeight ?? 3,
          front: cleanText(action.front, 12).toLowerCase() || 'south'
        })

      case 'build_watchtower':
        return this.builder.buildWatchtower({
          origin: action.origin || null,
          size: action.size ?? 7,
          wallHeight: action.wallHeight ?? 3
        })

      case 'build_preset':
        return this.builder.buildPreset(
          cleanText(action.name, 32).toLowerCase(),
          cleanText(action.material, 64).toLowerCase() || 'cobblestone',
          action.origin || null
        )

      case 'build_box':
        return this.builder.buildBox(
          action.origin || null,
          cleanText(action.material, 64).toLowerCase() || 'cobblestone',
          action.width,
          action.height,
          action.depth,
          action.hollow
        )

      case 'build_shape':
        return this.builder.buildShape(
          action.origin,
          cleanText(action.material, 64).toLowerCase() || 'cobblestone',
          action.blocks
        )

      case 'remember':
        this.memory.remember(action.note)
        return `remembered: ${cleanText(action.note, 160)}`

      case 'wait':
        await sleep(Math.max(0, Math.min(8, Number(action.seconds) || 1)) * 1000)
        return 'waited'

      default:
        throw new Error(`unsupported action: ${type}`)
    }
  }

  ensurePhysicalActivity (actions, replyRequired) {
    const physicalTypes = new Set([
      'walk_to', 'walk_to_player', 'wander', 'jump',
      'build_house', 'build_watchtower', 'build_preset', 'build_box', 'build_shape'
    ])
    const hasPhysical = actions.some(action => physicalTypes.has(action?.type))

    if (hasPhysical) {
      this.idleCycles = 0
      return actions
    }

    this.idleCycles++
    if (!replyRequired && this.idleCycles >= this.config.agent.maxIdleCycles && actions.length < this.config.agent.maxActions) {
      this.idleCycles = 0
      return [...actions, { type: 'wander', radius: 8 }]
    }
    return actions
  }

  async cycle () {
    if (!this.enabled || !this.bot.entity) return
    if (this.busy) {
      this.cycleRequested = true
      return
    }

    this.busy = true
    this.cycleRequested = false
    const replyRequired = this.pendingReplies[0] || null

    try {
      const state = this.state()
      const decision = await this.llm.decide(this.systemPrompt(), state)
      if (decision?.goal) this.goal = cleanText(decision.goal, 240)

      let actions = Array.isArray(decision?.actions)
        ? decision.actions.slice(0, this.config.agent.maxActions)
        : []

      if (replyRequired && !actions.some(action => action?.type === 'chat')) {
        try {
          const retry = await this.llm.decide(
            `${this.systemPrompt()}\n\nCRITICAL: A player is waiting for a reply. Return at least one chat action that directly answers state.replyRequired.message.`,
            state
          )
          const chatAction = Array.isArray(retry?.actions)
            ? retry.actions.find(action => action?.type === 'chat' && cleanText(action?.message, 240))
            : null
          if (chatAction) actions.unshift(chatAction)
        } catch (error) {
          console.error('[agent] reply retry failed:', cleanText(error.message, 300))
        }
      }

      if (replyRequired && !actions.some(action => action?.type === 'chat')) {
        actions.unshift({ type: 'chat', message: `${replyRequired.username}, I heard you.` })
      }

      actions = actions.slice(0, this.config.agent.maxActions)
      actions = this.ensurePhysicalActivity(actions, replyRequired).slice(0, this.config.agent.maxActions)
      if (!actions.length) actions.push({ type: 'wait', seconds: 1 })

      const results = []
      let replied = false
      let buildStarted = false
      for (const action of actions) {
        try {
          if (buildStarted && String(action?.type || '').startsWith('build_')) {
            results.push({ type: action.type, ok: false, error: 'skipped duplicate build action in the same cycle' })
            continue
          }
          if (String(action?.type || '').startsWith('build_')) buildStarted = true

          const result = await this.perform(action)
          results.push({ type: action.type, ok: true, result })
          if (action.type === 'chat') replied = true
        } catch (error) {
          results.push({ type: action?.type || 'unknown', ok: false, error: cleanText(error.message, 350) })
        }
      }

      if (replyRequired && replied && this.pendingReplies[0] === replyRequired) {
        this.pendingReplies.shift()
      }

      this.lastAction = JSON.stringify(results).slice(0, 3200)
      console.log('[agent]', cleanText(decision?.thought, 500), results)
    } catch (error) {
      this.lastAction = `agent cycle error: ${cleanText(error.message, 500)}`
      console.error('[agent]', error)
    } finally {
      this.busy = false
      if (this.enabled && (this.cycleRequested || this.pendingReplies.length > 0)) {
        this.cycleRequested = false
        setTimeout(() => this.cycle(), 100)
      }
    }
  }
}

module.exports = { AutonomousAgent }
