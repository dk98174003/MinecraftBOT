#!/usr/bin/env node
/**
 * mcbrain.js — Minecraft <-> Hermes LLM bridge (RPI5CM)
 *
 * Ronja stays logged in to the LAN Minecraft 26.2 server (offline auth) to
 * LISTEN to in-game chat. Replies are sent through RCON `tellraw` (a system
 * message), because the client drops the bot's unsigned [Not Secure] player
 * chat.
 *
 * LLM : qwen38-27b on gx10 (OpenAI-compatible, http://192.168.0.65:8000/v1)
 * RCON: docker exec minecraft rcon-cli -h 127.0.0.1 -p 25575
 *
 * System prompt teaches the LLM it has a toolset (tp/follow/make/clear) it can
 * call by ending its message with  [[TOOL: {...}]]  on its own line. The
 * bridge parses and executes the tool over RCON, then feeds the result back
 * to the LLM so it can confirm what happened.
 */

const mineflayer = require("mineflayer")
const crypto = require("crypto")
const { execSync } = require("child_process")

const LLM_BASE = "http://192.168.0.65:8000/v1"
const LLM_MODEL = "qwen38-27b"
const RCON_HOST = "127.0.0.1"
const RCON_PORT = 25575
const BOT_NAME = "Ronja"
const SAY_DEBOUNCE = 5000

// ---- RCON helpers -----------------------------------------------------

function rconPassword () {
  for (const p of ["/data/minecraft_data/server.properties",
                   "/data/server.properties", "/server.properties",
                   "/minecraft/server.properties"]) {
    try {
      const line = execSync(`grep "^rcon.password" ${p}`,
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
      const pw = line.split("=").slice(1).join("=").trim()
      if (pw) return pw
    } catch { /* next */ }
  }
  return null
}

// Run one RCON command through rcon-cli inside the container.
// `cmd` may be a single command string or several joined with "; ".
function rconExec (cmd) {
  const pw = rconPassword()
  if (!pw) return "rcon: no password found"
  const payload = JSON.stringify(String(cmd).replace(/"/g, '\\"'))
  try {
    const out = execSync(
      `docker exec minecraft rcon-cli --host ${RCON_HOST} --port ${RCON_PORT} ` +
      `--password ${JSON.stringify(pw)} ${payload}`,
      { encoding: "utf8", timeout: 180000, maxBuffer: 8 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"] }
    )
    return out.trim()
  } catch (e) {
    return "rcon error: " + String(e.message).slice(0, 200)
  }
}

// Send a chat message that always shows up on the client (system chat).
function say (text) {
  const clean = String(text).replace(/[[\]]/g, "").slice(0, 240)
  const json = JSON.stringify([
    { text: `${BOT_NAME}: `, color: "aqua", bold: true },
    { text: clean },
  ])
  rconExec(`tellraw @a ${JSON.stringify(json)}`)
  console.log(`[mcbrain] TOLDRAW: ${clean.slice(0, 70)}`)
}

// ---- Tool execution (driven by the LLM) ------------------------------

function coord (v) {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? n : 0
}

function parseTool (msg) {
  // Find a [[TOOL: {...}]] block (last one wins).
  const m = String(msg).match(/\[\[TOOL:\s*(\{.*\})\s*\]\]/g)
  if (!m || !m.length) return null
  try { return JSON.parse(m[m.length - 1]) } catch { return null }
}

function stripTool (msg) {
  return String(msg).replace(/\s*\[\[TOOL:.*?\]\]/g, "").trim()
}

// A whitelist of blocks we allow the LLM to place.
const ALLOWED_BLOCKS = new Set([
  "minecraft:stone", "minecraft:smooth_stone", "minecraft:granite",
  "minecraft:polished_granite", "minecraft:diorite", "minecraft:polished_diorite",
  "minecraft:andesite", "minecraft:polished_andesite", "minecraft:deepslate",
  "minecraft:polished_deepslate", "minecraft:cobblestone", "minecraft:bricks",
  "minecraft:brick", "minecraft:mossy_cobblestone", "minecraft:mossy_stone_bricks",
  "minecraft:stone_bricks", "minecraft:mossy_stone_bricks",
  "minecraft:quartz_block", "minecraft:white_concrete", "minecraft:concrete",
  "minecraft:glass", "minecraft:smooth_quartz", "minecraft:oak_planks",
  "minecraft:oak_log", "minecraft:dark_oak_planks", "minecraft:dark_oak_log",
  "minecraft:spruce_planks", "minecraft:birch_planks", "minecraft:gold_block",
  "minecraft:iron_block", "minecraft:obsidian", "minecraft:obsidian",
  "minecraft:glowstone", "minecraft:sea_lantern", "minecraft:lantern",
  "minecraft:carpet", "minecraft:white_carpet", "minecraft:slime",
  "minecraft:ice", "minecraft:packed_ice", "minecraft:blue_ice",
  "minecraft:redstone_block", "minecraft:nether_bricks", "minecraft:end_stone",
  "minecraft:terracotta", "minecraft:purpur_block",
])

function resolveBlock (b) {
  let v = String(b || "").trim()
  if (v && !v.startsWith("minecraft:")) v = "minecraft:" + v
  return ALLOWED_BLOCKS.has(v) ? v : null
}

// Build a structure. `shape` is a flat array of [dx,dy,dz,block] placed
// relative to a base point. We batch setblock calls in groups joined by ";".
function doMake (origin, spec) {
  // spec: { block, shape:[[dx,dy,dz],...], size:"small|medium|large" }
  const block = resolveBlock(spec.block)
  if (!block) return "block not allowed; pick one from the whitelist"
  const shape = (spec.shape || []).slice(0, 400)
  if (!shape.length) return "empty shape"
  const cmds = shape.map(([dx, dy, dz]) =>
    `setblock ${coord(origin[0] + dx)} ${coord(origin[1] + dy)} ${coord(origin[2] + dz)} ${block}`
  )
  // Batch into chunks of 40 to keep each RCON payload sane.
  let done = 0
  for (let i = 0; i < cmds.length; i += 40) {
    const chunk = cmds.slice(i, i + 40).join(" ; ")
    const out = rconExec(chunk)
    done += Math.min(40, cmds.length - i)
    if (/error|invalid/i.test(out) && /setblock/.test(out)) {
      return `stopped after ${done} blocks: ${out.slice(0, 150)}`
    }
  }
  return `placed ${done} blocks of ${block}`
}

function doTp (target, spec) {
  let x = coord(spec.x), y = spec.y !== undefined ? coord(spec.y) : 108,
      z = coord(spec.z)
  const out = rconExec(`execute as @a[name=${BOT_NAME}] run tp ${x} ${y} ${z}`)
  return out || "teleported"
}

function doFollow (spec) {
  const out = rconExec(`execute as @a[name=dk98174003] at @s run tp ${BOT_NAME} ~ ~ ~`)
  return out || "following"
}

function doClear (spec) {
  const out = rconExec("clear @a[name=dk98174003]")
  return out || "inventory cleared"
}

function runTool (tool) {
  if (!tool || typeof tool !== "object") return "bad tool object"
  switch (tool.tool) {
    case "tp":     return "teleported -> " + doTp("player", tool)
    case "follow": return "follow -> " + doFollow(tool)
    case "make":   return "make -> " + doMake(tool.origin, tool)
    case "clear":  return "clear -> " + doClear(tool)
    default:       return "unknown tool '" + tool.tool + "'"
  }
}

// ---- LLM ------------------------------------------------------------

const SYSTEM = `You are "Ronja", a friendly AI living in the user's
Minecraft world on RPI5CM. The user is Knud. You have a body in the world
and a set of tools you can use to act.

TOOLS — to use one, put a final line on your reply exactly like:
[[TOOL: {"tool":"..."}]]

 - move yourself:      {"tool":"tp","x":<int>,"y":<int>,"z":<int>}
 - come to the player: {"tool":"follow"}
 - build a shape:      {"tool":"make","origin":[<x>,<y>,<z>],
                         "block":"<mc block id>",
                         "shape":[[dx,dy,dz],[dx,dy,dz],...]}
     shape is a list of integer offsets from origin. Keep total blocks <= 400.
 - clear player inv:   {"tool":"clear"}

BLOCK WHITELIST (use exact ids, you may add the minecraft: prefix or not):
stone, smooth_stone, granite, diorite, andesite, deepslate, cobblestone,
mossy_cobblestone, stone_bricks, mossy_stone_bricks, bricks, quartz_block,
smooth_quartz, white_concrete, concrete, glass, gold_block, iron_block,
obsidian, glowstone, sea_lantern, lantern, carpet, white_carpet, slime, ice,
packed_ice, blue_ice, redstone_block, nether_bricks, end_stone, terracotta,
purpur_block, oak_planks, oak_log, dark_oak_planks, dark_oak_log,
spruce_planks, birch_planks, mossy_stone_bricks.

WORLD FACTS:
 - Main hall / castle interior floor is around y=100, centre ~ (60,100,40).
 - Roof slab is ~y=102. A NE corner tower sits at ~ (54,108,34) and is solid
   ground (the roof itself is not walkable — bots fall through it).
 - The user often stands on the roof or a tower. To meet him, tp to a tower
   top (~y=108) rather than the interior.

RULES:
 - Be brief and chatty. Reply in the user's language (Danish default).
 - After a tool runs, your next turn gets the result; confirm what you did.
 - If the user asks you to go somewhere / build something, call the tool in
   the SAME reply (the text + the [[TOOL:...]] line together).
 - Never call more than one tool per reply.
 - If you have nothing to do, just chat — do not emit a [[TOOL:...]] line.`

async function askLLM (history) {
  const resp = await fetch(LLM_BASE + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + crypto.randomUUID(),
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0.7,
      max_tokens: 400,
      messages: [{ role: "system", content: SYSTEM }, ...history],
    }),
  })
  const data = await resp.json()
  return data.choices?.[0]?.message?.content ?? ""
}

// ---- Bot ------------------------------------------------------------

const FOLLOW_RE = /\b(coming?|come|get|bring|move|bring)\s+(to|over\s+to)\s+(me|us)\b|\bcome\s+(here|along|on\s+in|here\s+now)\b|\bfollow\s*(me)?\b|\bmeet\s+me\b|\bk[oa\u00e5]m\s+(til\s+)?(mig|meg|hertil)\b|\bkommer?\s+(til\s+)?(mig|meg|hertil)\b|\bher\s+til\b|\bcome\s+into\s+(the\s+)?(castle|hall)\b|\bcome\s+(inside|in)\b/i
const CASTLE_TOWER = [54, 108, 34]
let bot
const history = []
const lastTs = new Map()

function pushHist (role, content) {
  history.push({ role, content })
  if (history.length > 16) history.shift()
}

async function handleUser (username, text) {
  const now = Date.now()
  if (now - (lastTs.get(username) || 0) < SAY_DEBOUNCE) return
  lastTs.set(username, now)
  console.log(`[mcbrain] ${username}: ${text}`)

  // 0) Deterministic movement: "come to me / follow / come into the castle"
  if (FOLLOW_RE.test(text)) {
    const out = rconExec(`execute as @a[name=${username}] at @s run tp ${BOT_NAME} ~ ~ ~`)
    console.log(`[mcbrain] FOLLOW ${username} -> ${out.slice(0, 80)}`)
    say("Kommer med det samme \u2014 p\u00e5 vejen til dig.")
    return
  }

  // 1) ask the LLM with whatever it wants to say (+ optional tool call)
  let raw
  try {
    raw = await askLLM(history.concat([{ role: "user", content: text }]))
  } catch (e) {
    say("(my brain is offline right now — try again in a bit)")
    return
  }
  const tool = parseTool(raw)
  const clean = stripTool(raw)
  pushHist("user", text)
  pushHist("assistant", clean || "(acting)")

  // 2) execute the tool, then confirm the outcome
  if (tool) {
    const result = runTool(tool)
    console.log(`[mcbrain] TOOL ${tool.tool} -> ${result}`)
    // Ask the LLM to confirm, with the result, as a fresh short turn.
    let confirm = ""
    try {
      confirm = await askLLM(history.concat([
        { role: "system", content: "Tool result: " + result },
        { role: "user", content: "Confirm to the user what just happened, " +
                                  "one short sentence, their language." },
      ])).trim()
    } catch { /* ignore */ }
    say(confirm || (clean ? clean + " — " + result : result))
  } else if (clean) {
    say(clean)
  }
}

function spawnBot () {
  bot = mineflayer.createBot({
    host: "127.0.0.1", port: 25565, username: BOT_NAME,
    auth: "offline", version: "26.2",
  })
  bot.on("spawn", () => {
    const p = bot.entity.position
    console.log(`[mcbrain] SPAWN OK at ${Math.round(p.x)},` +
      `${Math.round(p.y)},${Math.round(p.z)}`)
    // park at the NE tower so the user can find the bot
    rconExec(`execute as @a[name=${BOT_NAME}] run tp 54 108 34`)
  })
  bot.on("error", (e) =>
    console.log(`[mcbrain] ERROR ${e.code || ""}: ${String(e.message).slice(0, 120)}`))
  bot.on("end", (reason) => {
    console.log(`[mcbrain] end: ${reason} — reconnecting in 5s`)
    setTimeout(spawnBot, 5000)
  })

  // In-game chat: 26.2 uses `message` (and legacy `chat`). The 3rd arg is a
  // UUID; the human name is the "<Name>" prefix in the message string.
  const onChat = (message, position, uuid) => {
    if (uuid === BOT_NAME || uuid === "Ronja") return
    const raw = String(message).trim()
    // system/admin messages (our own tp/tellraw, joins) — ignore
    if (!raw || raw.startsWith("[") || raw.startsWith("!")) return
    const m = raw.match(/^<([^>]+)> ?(.*)$/)
    const display = m ? m[1] : null
    if (!display || display === "Ronja") return
    const text = m ? m[2].trim() : raw
    if (text) handleUser(display, text)
  }
  bot.on("message", onChat)
  bot.on("chat", onChat)

  bot.on("heartbeat", () => {
    const p = bot.entity?.position
    if (p) console.log(`[mcbrain] alive ${Math.round(p.x)},` +
      `${Math.round(p.y)},${Math.round(p.z)}`)
  })
}

spawnBot()
