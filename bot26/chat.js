const mineflayer = require("mineflayer")
const bot = mineflayer.createBot({ host:"127.0.0.1", port:25565, username:"Ronja", auth:"offline", version:"26.2" })
bot.once("spawn", () => {
  setTimeout(() => {
    const p = bot.entity.position
    console.log("bot at", p.x.toFixed(0), p.y.toFixed(0), p.z.toFixed(0))
    bot.chat("Hello from Ronja on 26.2")
    setTimeout(() => { bot.quit(); process.exit(0) }, 3000)
  }, 3000)
})
bot.on("error",(e)=>{console.log("ERROR",e.message);process.exit(1)})
setTimeout(()=>{console.log("TIMEOUT");process.exit(2)},20000)
