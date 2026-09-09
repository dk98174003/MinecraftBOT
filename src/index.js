#!/usr/bin/env node
require('dotenv').config()

const mineflayer = require('mineflayer')
const config = require('./config')
const { Rcon } = require('./rcon')
const { LlmClient } = require('./llm')
const { MemoryStore } = require('./memory')
const { MovementController } = require('./movement')
const { Builder } = require('./building')
const { AutonomousAgent } = require('./agent')

let active = null
let reconnectTimer = null

function parseMessageEvent (jsonMessage) {
  const text = String(jsonMessage?.toString?.() ?? jsonMessage ?? '').trim()
  const patterns = [
    /^<([^>]+)>\s*(.*)$/,
    /^\[Not Secure\]\s*<([^>]+)>\s*(.*)$/,
    /^([^:<>]{1,32}):\s+(.+)$/,
    /^([^:<>]{1,32})\s+whispers(?:\s+to\s+you)?:\s+(.+)$/i
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return { username: match[1].trim(), message: match[2].trim() }
  }
  return null
}

function applyCreativePolicy (rcon) {
  if (!config.world.creativeForAll || !config.rcon.enabled) return
  try {
    rcon.execMany([
      'defaultgamemode creative',
      'gamemode creative @a'
    ])
    console.log('[world] Creative mode enforced for all players')
  } catch (error) {
    console.error('[world] failed to enforce Creative mode:', error.message)
  }
}

function setPlayerCreative (rcon, username) {
  if (!config.world.creativeForAll || !config.rcon.enabled) return
  if (!/^[A-Za-z0-9_]{1,32}$/.test(String(username || ''))) return
  try {
    rcon.exec(`gamemode creative ${username}`)
    console.log(`[world] set ${username} to Creative`)
  } catch (error) {
    console.error(`[world] failed to set ${username} Creative:`, error.message)
  }
}

function create () {
  console.log(`[boot] connecting ${config.mc.username} to ${config.mc.host}:${config.mc.port} (${config.mc.version})`)

  const bot = mineflayer.createBot({
    host: config.mc.host,
    port: config.mc.port,
    username: config.mc.username,
    auth: config.mc.auth,
    version: config.mc.version
  })

  const rcon = new Rcon(config.rcon)
  const llm = new LlmClient(config.llm)
  const memory = new MemoryStore()
  const movement = new MovementController(bot, config.movement)
  const builder = new Builder(bot, rcon, config.build, memory, movement)
  const agent = new AutonomousAgent({ bot, config, llm, rcon, movement, builder, memory })

  active = { bot, agent }

  bot.once('spawn', () => {
    const p = bot.entity?.position
    console.log(`[minecraft] spawned at ${p ? `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}` : 'unknown'}`)
    applyCreativePolicy(rcon)
    agent.start()
  })

  bot.on('playerJoined', player => {
    if (!player?.username) return
    setTimeout(() => setPlayerCreative(rcon, player.username), 500)
  })

  async function handlePlayerMessage (username, message, source) {
    if (!username || username === bot.username) return
    try {
      if (await agent.command(username, message)) return
      if (agent.addChat(username, message, source) && agent.enabled) {
        agent.requestCycle()
      }
    } catch (error) {
      console.error(`[${source}]`, error)
    }
  }

  bot.on('chat', (username, message) => {
    handlePlayerMessage(username, message, 'chat')
  })

  // Minecraft 26.2 in the custom fork commonly emits "message". Handle the
  // common rendered chat/whisper formats as a fallback to the chat event.
  bot.on('message', jsonMessage => {
    const parsed = parseMessageEvent(jsonMessage)
    if (!parsed) return
    handlePlayerMessage(parsed.username, parsed.message, 'message')
  })

  bot.on('death', () => {
    agent.lastAction = 'died; waiting for respawn'
    movement.stop()
    console.warn(`[minecraft] ${bot.username || config.mc.username} died`)
  })

  bot.on('kicked', reason => console.error('[minecraft] kicked:', reason))
  bot.on('error', error => console.error('[minecraft] error:', error))

  bot.on('end', reason => {
    console.error('[minecraft] disconnected:', reason)
    agent.stop()
    if (active?.bot === bot) active = null
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(create, 5000)
  })
}

process.on('SIGINT', () => {
  clearTimeout(reconnectTimer)
  active?.agent?.stop()
  active?.bot?.quit?.('shutdown')
  process.exit(0)
})

process.on('SIGTERM', () => {
  clearTimeout(reconnectTimer)
  active?.agent?.stop()
  active?.bot?.quit?.('shutdown')
  process.exit(0)
})

process.on('unhandledRejection', error => console.error('[unhandledRejection]', error))
process.on('uncaughtException', error => console.error('[uncaughtException]', error))

create()
