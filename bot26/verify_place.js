const mineflayer = require("mineflayer");
const Vec3 = require("vec3");
const { execSync } = require("child_process");
const rconPw = process.env.RCON_PW;
const BOT = "blockprobe";
function rcon(cmd){
  return execSync(`docker exec minecraft rcon-cli --password ${JSON.stringify(rconPw)} --host 127.0.0.1 --port 25575 ${JSON.stringify(cmd)}`, {encoding:"utf8"}).trim();
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const V = (x,y,z)=>new Vec3(x,y,z);
(async () => {
  for (let x = 18; x <= 22; x++) for (let z = 18; z <= 22; z++) {
    rcon(`setblock ${x} 100 ${z} minecraft:stone`);
    rcon(`setblock ${x} 101 ${z} minecraft:air`);
  }
  rcon("setblock 23 100 20 minecraft:air");
  await sleep(1500);
  console.log("RCON: stone floor y=100 (18-22), air above, target (23,100,20)=air");

  const bot = mineflayer.createBot({ host:"127.0.0.1", port:25565, username:BOT, version:"26.2" });
  bot.on("kicked", m => { console.log("KICKED:", JSON.stringify(m)); process.exit(2); });
  bot.on("error", e => { if(!bot.isEnding) console.log("BOT_ERR:", e.message); });
  bot.once("spawn", async () => {
    await sleep(2500);
    // give stone + tp after the bot is online
    rcon(`give ${BOT} minecraft:stone 64`);
    rcon(`teleport ${BOT} 22.5 101.0 20.5`);
    await sleep(2000);
    let p = bot.entity.position;
    console.log("bot pos:", p.toString(), "onGround:", bot.entity.onGround);
    let stone = bot.inventory.items().find(i => i.name === "minecraft:stone");
    console.log("inv stone?", !!stone, "count:", stone && stone.count);
    if (stone) await bot.equip(stone, "hand");

    const supportLoc = V(22,100,20);
    const targetLoc  = V(23,100,20);
    const support = bot.blockAt(supportLoc);
    const targetBefore = bot.blockAt(targetLoc);
    console.log("support:", support && support.name, "@", supportLoc.toString());
    console.log("target before:", targetBefore && targetBefore.name, "@", targetLoc.toString());
    const dist = bot.entity.position.distanceTo(supportLoc);
    console.log("dist bot->support:", dist.toFixed(2));
    await bot.lookAt(supportLoc);
    await sleep(500);
    try {
      const res = await bot.placeBlock(support, V(1,0,0)); // faceVector +x
      console.log("placeBlock() RESOLVED ->", res && res.name, "@", targetLoc.toString());
    } catch(e){ console.log("placeBlock err:", e.message); }
    await sleep(1000);
    const after = bot.blockAt(targetLoc);
    console.log("target AFTER:", after && after.name, "(expect minecraft:stone)");
    const pass = after && after.name === "minecraft:stone";
    console.log("RESULT:", pass ? "PASS - block placed via 0x42" : "FAIL");
    bot.quit();
    process.exit(pass ? 0 : 4);
  });
  setTimeout(()=>{ console.log("OVERALL TIMEOUT"); process.exit(3); }, 50000);
})().catch(e=>{ console.error("FATAL", e.message); process.exit(1); });
