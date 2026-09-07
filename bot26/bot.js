#!/usr/bin/env node
/**
 * Hermes Minecraft 26.2 in-game bot (mineflayer 26.2 runtime)
 *
 * Why: server runs Minecraft Java 26.2 (protocol 776). Stock mineflayer
 * (npm) only supports up to 1.21.x / 26.1, so it cannot hand-shake with 26.2.
 * This uses the Complexity-ML 26.2 runtime stack (installed from tarball into
 * this dir; see package.json -> mineflayer 4.37.1+complexity.26.2.3).
 *
 * Auth: server runs offline-mode (LAN) -> auth:"offline", no MS login needed.
 *   compose: /data/compose/minecraft/docker-compose.yml  ONLINE_MODE: "false"
 *   backup:  /data/compose/minecraft/docker-compose.yml.bak-online
 *
 * Run: node bot.js            # connect, report spawn, idle
 *       node bot.js "msg"      # connect, send chat message, idle
 */
const mineflayer = require("mineflayer")

const bot = mineflayer.createBot({
  host: "127.0.0.1",
  port: 25565,
  username: "Ronja",
  auth: "offline",
  version: "26.2",
})

bot.once("spawn", () => {
  const p = bot.entity.position
  console.log(`[bot] SPAWN OK at ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`)
  const msg = process.argv[2]
  if (msg) bot.chat(msg)
  console.log("[bot] connected and idle; Ctrl-C to quit")
})
bot.on("kicked", (r) => { console.log("[bot] kicked:", JSON.stringify(r)); process.exit(1) })
bot.on("error", (e) => console.log("[bot] error:", e.message))
bot.on("end", (r) => console.log("[bot] disconnected:", r || "no reason"))
