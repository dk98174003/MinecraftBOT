const mineflayer = require("mineflayer");
const msg = process.argv[2] || "meeting@castle-roof";
const bot = mineflayer.createBot({ host:"127.0.0.1", port:25565, username:"Ronja", version:"26.2" });
bot.on("kicked", r => { console.error("[roof-bot] KICKED:", r.toString()); process.exit(1); });
bot.on("error", e => { console.error("[roof-bot] ERROR:", e.message); });
bot.on("end", () => { console.error("[roof-bot] ended"); process.exit(1); });
bot.on("spawn", () => {
  console.log("[roof-bot] SPAWN OK; msg=" + msg);
  try { bot.chat(msg); } catch(e){}
  setInterval(() => { const p=bot.entity&&bot.entity.position; if(p) console.log("[roof-bot] alive @", p.round().x, p.round().y, p.round().z); }, 20000);
});
