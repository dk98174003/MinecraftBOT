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
    this.goal = 'Stay safe, explore, interact naturally with players, and improve the world with useful builds.'
    this.seenMessages = new Map()
  }

  systemPrompt () {
    const name = this.bot.username || this.config.mc.username || 'Eva'
    return `You are ${name}, an autonomous female AI character physically embodied in a Minecraft Java 26.2 world.
Your brain is a local Qwen model, but speak as ${name} rather than as an assistant.

You operate continuously even when no player is talking to you. Make small useful decisions: walk around, inspect nearby players, socialize when appropriate, and build modest structures. You may initiate actions yourself.

Behavior:
- Friendly, curious, practical, independent, and concise.
- Respond in the player's language. Danish is common, but follow the language actually used.
- When state.replyRequired is present, answering that player is your highest priority. Include a chat action that directly responds to their message before optional movement or building actions.
- Never silently ignore state.replyRequired. Normal background conversation may be ignored only when replyRequired is null.
- Do not spam chat.
- Do not grief, destroy player structures, clear inventories, attack players, or modify distant areas.
- Prefer walking over teleportation. Walking is real Mineflayer movement.
- Building uses trusted RCON setblock commands, but origins are distance-limited around your current body.
- If a movement/build action fails, adapt on the next cycle rather than pretending it succeeded.
- Stay alive: avoid unsafe drops and do not deliberately enter lava/water hazards.
- Use memory for facts worth keeping across restarts.
- Keep plans incremental. Maximum ${this.config.agent.maxActions} actions per cycle.

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
    {"type":"build_preset","name":"platform|wall|tower|hut|bridge","material":"cobblestone","origin":{"x":0,"y":99,"z":0}},
    {"type":"build_shape","material":"stone_bricks","origin":{"x":0,"y":99,"z":0},"blocks":[[0,0,0],[1,0,0]]},
    {"type":"remember","note":"fact worth retaining"},
    {"type":"wait","seconds":2}
  ]
}

Only use these action types. Omit origin for build_preset to build a few blocks beside your current position.`
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

    try {
      this.rcon.say(this.bot.username || this.config.mc.username || 'Eva', clean)
    } catch (error) {
      if (typeof this.bot.chat !== 'function') throw error
      this.bot.chat(clean)
    }
    return `said: ${clean}`
  }

  async command (username, message) {
    const text = cleanText(message).toLowerCase()
    const commandPrefix = `!${String(this.bot.username || this.config.mc.username || 'Eva').toLowerCase()}`
    if (!text.startsWith(commandPrefix)) return false

    const command = text.split(/\s+/)[1] || 'status'
    if (command === 'status') {
      await this.say(`auto=${this.enabled ? 'on' : 'off'} | goal: ${this.goal}`)
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
      recentChat: this.chat.slice(-14),
      replyRequired: this.pendingReplies[0] || null,
      pendingReplyCount: this.pendingReplies.length,
      memory: this.memory.context(),
      homePosition: this.config.agent.home,
      capabilities: {
        walking: true,
        chat: true,
        autonomous: true,
        building: this.config.rcon.enabled,
        buildPresets: ['platform', 'wall', 'tower', 'hut', 'bridge']
      }
    })
  }

  async perform (action) {
    const type = action?.type

    switch (type) {
      case 'chat':
        return this.say(action.message)

      case 'walk_to':
        return this.movement.walkTo({
          x: action.x, y: action.y, z: action.z
        }, action.range)

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

      case 'build_preset':
        return this.builder.buildPreset(
          cleanText(action.name, 32).toLowerCase(),
          cleanText(action.material, 64).toLowerCase() || 'cobblestone',
          action.origin || null
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
      if (!actions.length) actions.push({ type: 'wait', seconds: 1 })

      const results = []
      let replied = false
      for (const action of actions) {
        try {
          const result = await this.perform(action)
          results.push({ type: action.type, ok: true, result })
          if (action.type === 'chat') replied = true
        } catch (error) {
          results.push({ type: action?.type || 'unknown', ok: false, error: cleanText(error.message, 250) })
        }
      }

      if (replyRequired && replied && this.pendingReplies[0] === replyRequired) {
        this.pendingReplies.shift()
      }

      this.lastAction = JSON.stringify(results).slice(0, 1400)
      console.log('[agent]', cleanText(decision?.thought, 300), results)
    } catch (error) {
      this.lastAction = `agent cycle error: ${cleanText(error.message, 400)}`
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
