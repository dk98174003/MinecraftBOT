const mineflayer = require("mineflayer")
const bot = mineflayer.createBot({
  host: "127.0.0.1",
  port: 25565,
  username: "Ronja",
  auth: "offline",
  version: "26.2"
})
bot.once("spawn", () => {
  console.log("SPAWN_OK at", bot.entity.position.toString())
  process.exit(0)
})
bot.on("kicked", (r) => { console.log("KICKED:", JSON.stringify(r)); process.exit(1) })
bot.on("error", (e) => { console.log("ERROR:", e.message); process.exit(1) })
bot.on("end", (r) => { console.log("END:", r || "no reason"); process.exit(1) })
setTimeout(() => { console.log("TIMEOUT_no_spawn_in_45s"); process.exit(2) }, 45000)
