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
  const match = text.match(/^<([^>]+)>\s*(.*)$/)
  if (!match) return null
  return { username: match[1], message: match[2] }
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
  const builder = new Builder(bot, rcon, config.build, memory)
  const agent = new AutonomousAgent({ bot, config, llm, rcon, movement, builder, memory })

  active = { bot, agent }

  bot.once('spawn', () => {
    const p = bot.entity?.position
    console.log(`[minecraft] spawned at ${p ? `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}` : 'unknown'}`)
    agent.start()
  })

  bot.on('chat', async (username, message) => {
    if (username === bot.username) return
    try {
      if (await agent.command(username, message)) return
      if (agent.addChat(username, message, 'chat') && agent.enabled) {
        setTimeout(() => agent.cycle(), 100)
      }
    } catch (error) {
      console.error('[chat]', error)
    }
  })

  // Minecraft 26.2 in the custom fork commonly emits "message"; parse <Name> text.
  bot.on('message', async (jsonMessage) => {
    const parsed = parseMessageEvent(jsonMessage)
    if (!parsed || parsed.username === bot.username) return
    try {
      if (await agent.command(parsed.username, parsed.message)) return
      if (agent.addChat(parsed.username, parsed.message, 'message') && agent.enabled) {
        setTimeout(() => agent.cycle(), 100)
      }
    } catch (error) {
      console.error('[message]', error)
    }
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
