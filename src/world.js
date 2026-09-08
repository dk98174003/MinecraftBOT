const { Vec3 } = require('vec3')

function floorPos (position) {
  if (!position) return null
  return {
    x: Math.floor(Number(position.x) || 0),
    y: Math.floor(Number(position.y) || 0),
    z: Math.floor(Number(position.z) || 0)
  }
}

function blockAtCompat (bot, x, y, z) {
  try {
    const block = bot.blockAt(x, y, z)
    if (block) return block
  } catch {
    // Standard Mineflayer signature uses Vec3.
  }

  try {
    return bot.blockAt(new Vec3(x, y, z))
  } catch {
    return null
  }
}

function blockName (block) {
  if (!block) return 'unknown'
  return String(block.name || block.displayName || block.type || 'unknown')
    .replace(/^minecraft:/, '')
}

function isAir (block) {
  const name = blockName(block)
  return name === 'air' || name === 'cave_air' || name === 'void_air' ||
    block?.boundingBox === 'empty'
}

function inventorySummary (bot) {
  try {
    if (typeof bot.inventory?.items === 'function') {
      return bot.inventory.items().slice(0, 40).map(item => ({
        name: String(item.name || item.displayName || item.type),
        count: item.count
      }))
    }

    const slots = bot.inventory?.slots || {}
    return Object.values(slots).filter(Boolean).slice(0, 40).map(item => ({
      name: String(item.name || item.displayName || item.type),
      count: item.count
    }))
  } catch {
    return []
  }
}

function nearbyPlayers (bot) {
  if (!bot.entity?.position) return []
  const here = bot.entity.position

  return Object.entries(bot.players || {})
    .filter(([name, player]) => name !== bot.username && player?.entity?.position)
    .map(([name, player]) => ({
      name,
      distance: Number(here.distanceTo(player.entity.position).toFixed(1)),
      position: floorPos(player.entity.position)
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 12)
}

function localBlocks (bot) {
  const p = floorPos(bot.entity?.position)
  if (!p) return {}

  const offsets = {
    feet: [0, 0, 0],
    below: [0, -1, 0],
    north: [0, 0, -1],
    south: [0, 0, 1],
    west: [-1, 0, 0],
    east: [1, 0, 0],
    northBelow: [0, -1, -1],
    southBelow: [0, -1, 1],
    westBelow: [-1, -1, 0],
    eastBelow: [1, -1, 0]
  }

  return Object.fromEntries(Object.entries(offsets).map(([key, [dx, dy, dz]]) => {
    return [key, blockName(blockAtCompat(bot, p.x + dx, p.y + dy, p.z + dz))]
  }))
}

function worldState (bot, extras = {}) {
  return {
    identity: { name: bot.username },
    position: floorPos(bot.entity?.position),
    health: bot.health,
    food: bot.food,
    timeOfDay: bot.time?.timeOfDay ?? null,
    raining: Boolean(bot.isRaining),
    nearbyPlayers: nearbyPlayers(bot),
    inventory: inventorySummary(bot),
    localBlocks: localBlocks(bot),
    ...extras
  }
}

module.exports = {
  blockAtCompat,
  blockName,
  floorPos,
  isAir,
  nearbyPlayers,
  worldState
}
