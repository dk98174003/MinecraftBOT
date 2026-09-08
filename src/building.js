const { floorPos } = require('./world')

const ALLOWED_BLOCKS = new Set([
  'stone', 'smooth_stone', 'granite', 'polished_granite', 'diorite',
  'polished_diorite', 'andesite', 'polished_andesite', 'deepslate',
  'polished_deepslate', 'cobblestone', 'mossy_cobblestone', 'stone_bricks',
  'mossy_stone_bricks', 'bricks', 'quartz_block', 'smooth_quartz',
  'white_concrete', 'pink_concrete', 'magenta_concrete', 'purple_concrete',
  'glass', 'gold_block', 'iron_block', 'obsidian', 'glowstone', 'sea_lantern',
  'lantern', 'white_carpet', 'pink_carpet', 'packed_ice', 'blue_ice',
  'redstone_block', 'nether_bricks', 'end_stone', 'terracotta', 'purpur_block',
  'oak_planks', 'oak_log', 'dark_oak_planks', 'dark_oak_log',
  'spruce_planks', 'spruce_log', 'birch_planks', 'birch_log'
])

function blockId (name) {
  const clean = String(name || '').replace(/^minecraft:/, '').trim()
  if (!ALLOWED_BLOCKS.has(clean)) throw new Error(`building block is not allowed: ${clean || '(empty)'}`)
  return `minecraft:${clean}`
}

function integerPoint (point) {
  const p = {
    x: Math.round(Number(point?.x)),
    y: Math.round(Number(point?.y)),
    z: Math.round(Number(point?.z))
  }
  if (![p.x, p.y, p.z].every(Number.isFinite)) throw new Error('invalid build origin')
  return p
}

function add (out, x, y, z) {
  out.push([x, y, z])
}

function preset (name) {
  const out = []

  switch (name) {
    case 'platform':
      for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) add(out, x, 0, z)
      break

    case 'wall':
      for (let x = -3; x <= 3; x++) for (let y = 0; y <= 2; y++) add(out, x, y, 0)
      break

    case 'tower':
      for (let y = 0; y <= 5; y++) {
        for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
          if (x === -1 || x === 1 || z === -1 || z === 1) add(out, x, y, z)
        }
      }
      break

    case 'hut':
      for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) add(out, x, 0, z)
      for (let y = 1; y <= 3; y++) {
        for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
          const edge = x === -2 || x === 2 || z === -2 || z === 2
          const doorway = z === 2 && x === 0 && y <= 2
          if (edge && !doorway) add(out, x, y, z)
        }
      }
      for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) add(out, x, 4, z)
      break

    case 'bridge':
      for (let x = 0; x <= 8; x++) {
        for (let z = -1; z <= 1; z++) add(out, x, 0, z)
      }
      break

    default:
      throw new Error(`unknown build preset: ${name}`)
  }

  return out
}

class Builder {
  constructor (bot, rcon, config, memory) {
    this.bot = bot
    this.rcon = rcon
    this.config = config
    this.memory = memory
  }

  defaultOrigin () {
    const p = floorPos(this.bot.entity?.position)
    if (!p) throw new Error('bot position is unavailable')
    return { x: p.x + 3, y: p.y - 1, z: p.z }
  }

  validateOrigin (origin) {
    const p = floorPos(this.bot.entity?.position)
    if (!p) throw new Error('bot position is unavailable')
    const o = integerPoint(origin || this.defaultOrigin())
    const distance = Math.hypot(o.x - p.x, o.y - p.y, o.z - p.z)
    if (distance > this.config.maxDistance) {
      throw new Error(`build origin is ${distance.toFixed(1)} blocks away; walk closer first`)
    }
    return o
  }

  runSetblocks (origin, material, offsets) {
    const id = blockId(material)
    const limited = offsets.slice(0, this.config.maxBlocks)
    if (!limited.length) throw new Error('build contains no blocks')

    const commands = limited.map(([dx, dy, dz]) => {
      const x = origin.x + Math.round(Number(dx) || 0)
      const y = origin.y + Math.round(Number(dy) || 0)
      const z = origin.z + Math.round(Number(dz) || 0)
      return `setblock ${x} ${y} ${z} ${id}`
    })

    this.rcon.execMany(commands)
    return { done: commands.length, material: id }
  }

  buildPreset (name, material = 'cobblestone', origin = null) {
    const safeOrigin = this.validateOrigin(origin)
    const shape = preset(String(name || '').toLowerCase())
    const result = this.runSetblocks(safeOrigin, material, shape)
    this.memory.rememberBuild({
      kind: 'preset',
      name,
      origin: safeOrigin,
      material: result.material,
      blocks: result.done
    })
    return `built ${name} at ${safeOrigin.x},${safeOrigin.y},${safeOrigin.z} using ${result.material}; ${result.done} blocks`
  }

  buildShape (origin, material, blocks) {
    if (!Array.isArray(blocks)) throw new Error('blocks must be an array of [dx,dy,dz]')
    const safe = blocks
      .filter(v => Array.isArray(v) && v.length >= 3)
      .slice(0, Math.min(200, this.config.maxBlocks))
    const safeOrigin = this.validateOrigin(origin)
    const result = this.runSetblocks(safeOrigin, material, safe)
    this.memory.rememberBuild({
      kind: 'shape',
      origin: safeOrigin,
      material: result.material,
      blocks: result.done
    })
    return `built custom shape at ${safeOrigin.x},${safeOrigin.y},${safeOrigin.z}; ${result.done} blocks`
  }
}

module.exports = { Builder, ALLOWED_BLOCKS }
