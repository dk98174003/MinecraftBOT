const { Vec3 } = require('vec3')
const { floorPos, blockAtCompat, blockName, isAir } = require('./world')
const { sleep } = require('./movement')

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

const SAFE_REPLACEABLE = new Set([
  'air', 'cave_air', 'void_air', 'short_grass', 'tall_grass', 'fern',
  'large_fern', 'dead_bush', 'snow', 'vine'
])

const HOUSE_STYLES = {
  stone_cottage: {
    floor: 'oak_planks',
    wall: 'stone_bricks',
    trim: 'oak_log',
    roof: 'dark_oak_planks',
    window: 'glass',
    light: 'lantern'
  },
  oak_cottage: {
    floor: 'oak_planks',
    wall: 'oak_planks',
    trim: 'oak_log',
    roof: 'dark_oak_planks',
    window: 'glass',
    light: 'lantern'
  },
  spruce_cottage: {
    floor: 'spruce_planks',
    wall: 'stone_bricks',
    trim: 'spruce_log',
    roof: 'spruce_planks',
    window: 'glass',
    light: 'lantern'
  }
}

function cleanBlockName (name) {
  return String(name || '').replace(/^minecraft:/, '').trim().toLowerCase()
}

function blockId (name) {
  const clean = cleanBlockName(name)
  if (!ALLOWED_BLOCKS.has(clean)) throw new Error(`building block is not allowed: ${clean || '(empty)'}`)
  return `minecraft:${clean}`
}

function itemName (item) {
  return cleanBlockName(item?.name || item?.displayName || item?.type)
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

function dimension (value, name, min = 1, max = 32) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be between ${min} and ${max}`)
  return n
}

function oddDimension (value, name, min = 5, max = 13) {
  let n = dimension(value, name, min, max)
  if (n % 2 === 0) n = n === max ? n - 1 : n + 1
  return n
}

function addOffset (out, x, y, z) {
  out.push([x, y, z])
}

function makeBlock (dx, dy, dz, material, phase = 0) {
  return { dx, dy, dz, material: cleanBlockName(material), phase }
}

function putBlock (map, dx, dy, dz, material, phase = 0) {
  map.set(`${dx},${dy},${dz}`, makeBlock(dx, dy, dz, material, phase))
}

function presetOffsets (name) {
  const out = []

  switch (name) {
    case 'platform':
      for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) addOffset(out, x, 0, z)
      break

    case 'wall':
      for (let x = -3; x <= 3; x++) for (let y = 0; y <= 2; y++) addOffset(out, x, y, 0)
      break

    case 'bridge':
      for (let x = 0; x <= 8; x++) for (let z = -1; z <= 1; z++) addOffset(out, x, 0, z)
      break

    default:
      throw new Error(`unknown simple build preset: ${name}`)
  }

  return out
}

function boxOffsets (width, height, depth, hollow) {
  const w = dimension(width, 'width')
  const h = dimension(height, 'height')
  const d = dimension(depth, 'depth')
  const out = []

  if (!hollow && w >= 4 && h >= 3 && d >= 4 && w * h * d > 96) {
    throw new Error('refusing a large solid cuboid; use hollow=true or a semantic structure such as build_house')
  }

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      for (let z = 0; z < d; z++) {
        if (!hollow || x === 0 || x === w - 1 || y === 0 || y === h - 1 || z === 0 || z === d - 1) {
          addOffset(out, x, y, z)
        }
      }
    }
  }
  return out
}

function frontDoorCell (front, w, d, x, z) {
  const cx = Math.floor(w / 2)
  const cz = Math.floor(d / 2)
  if (front === 'north') return z === 0 && x === cx
  if (front === 'east') return x === w - 1 && z === cz
  if (front === 'west') return x === 0 && z === cz
  return z === d - 1 && x === cx
}

function windowCell (front, w, d, x, z, y) {
  if (y !== 2) return false
  const onNorthSouth = (z === 0 || z === d - 1) && x > 0 && x < w - 1
  const onEastWest = (x === 0 || x === w - 1) && z > 0 && z < d - 1
  if (!onNorthSouth && !onEastWest) return false
  if (frontDoorCell(front, w, d, x, z)) return false

  if (z === 0 || z === d - 1) {
    return x === 2 || x === w - 3
  }
  return z === 2 || z === d - 3
}

function houseBlueprint (options = {}) {
  const width = oddDimension(options.width ?? 7, 'house width')
  const depth = oddDimension(options.depth ?? 7, 'house depth')
  const wallHeight = dimension(options.wallHeight ?? 3, 'house wallHeight', 3, 4)
  const front = ['north', 'south', 'east', 'west'].includes(String(options.front || '').toLowerCase())
    ? String(options.front).toLowerCase()
    : 'south'
  const styleName = HOUSE_STYLES[String(options.style || '').toLowerCase()]
    ? String(options.style).toLowerCase()
    : 'stone_cottage'
  const style = HOUSE_STYLES[styleName]
  const blocks = new Map()

  for (let x = 0; x < width; x++) {
    for (let z = 0; z < depth; z++) putBlock(blocks, x, 0, z, style.floor, 10)
  }

  for (let y = 1; y <= wallHeight; y++) {
    for (let x = 0; x < width; x++) {
      for (let z = 0; z < depth; z++) {
        const edge = x === 0 || x === width - 1 || z === 0 || z === depth - 1
        if (!edge) continue
        if (frontDoorCell(front, width, depth, x, z) && y <= 2) continue
        if (windowCell(front, width, depth, x, z, y)) continue
        putBlock(blocks, x, y, z, style.wall, 20)
      }
    }
  }

  for (const [x, z] of [[0, 0], [width - 1, 0], [0, depth - 1], [width - 1, depth - 1]]) {
    for (let y = 1; y <= wallHeight; y++) putBlock(blocks, x, y, z, style.trim, 25)
  }

  for (let x = 0; x < width; x++) {
    for (let z = 0; z < depth; z++) {
      if (windowCell(front, width, depth, x, z, 2)) putBlock(blocks, x, 2, z, style.window, 30)
    }
  }

  const roofY = wallHeight + 1
  for (let x = -1; x <= width; x++) {
    for (let z = -1; z <= depth; z++) putBlock(blocks, x, roofY, z, style.roof, 40)
  }

  if (front === 'north' || front === 'south') {
    const ridgeZ = Math.floor(depth / 2)
    for (let x = 0; x < width; x++) putBlock(blocks, x, roofY + 1, ridgeZ, style.roof, 45)
  } else {
    const ridgeX = Math.floor(width / 2)
    for (let z = 0; z < depth; z++) putBlock(blocks, ridgeX, roofY + 1, z, style.roof, 45)
  }

  putBlock(blocks, 1, 1, 1, style.light, 15)
  putBlock(blocks, width - 2, 1, depth - 2, style.light, 15)

  return {
    kind: 'house',
    style: styleName,
    width,
    depth,
    wallHeight,
    front,
    blocks: [...blocks.values()]
  }
}

function watchtowerBlueprint (options = {}) {
  const size = oddDimension(options.size ?? 7, 'tower size', 5, 9)
  const wallHeight = dimension(options.wallHeight ?? 3, 'tower wallHeight', 3, 4)
  const wall = cleanBlockName(options.wall || 'stone_bricks')
  const floor = cleanBlockName(options.floor || 'oak_planks')
  const window = cleanBlockName(options.window || 'glass')
  const light = cleanBlockName(options.light || 'lantern')
  for (const material of [wall, floor, window, light]) blockId(material)

  const blocks = new Map()
  const center = Math.floor(size / 2)

  for (let x = 0; x < size; x++) for (let z = 0; z < size; z++) putBlock(blocks, x, 0, z, floor, 10)

  for (let y = 1; y <= wallHeight; y++) {
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        const edge = x === 0 || x === size - 1 || z === 0 || z === size - 1
        if (!edge) continue
        if (z === size - 1 && x === center && y <= 2) continue
        const windowCellHere = y === 2 && ((x === center && (z === 0 || z === size - 1)) || (z === center && (x === 0 || x === size - 1)))
        if (!windowCellHere) putBlock(blocks, x, y, z, wall, 20)
      }
    }
  }

  for (const [x, z] of [[center, 0], [0, center], [size - 1, center]]) {
    putBlock(blocks, x, 2, z, window, 30)
  }

  const deckY = wallHeight + 1
  for (let x = 0; x < size; x++) for (let z = 0; z < size; z++) putBlock(blocks, x, deckY, z, wall, 40)

  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      const edge = x === 0 || x === size - 1 || z === 0 || z === size - 1
      if (edge && (x + z) % 2 === 0) putBlock(blocks, x, deckY + 1, z, wall, 45)
    }
  }

  putBlock(blocks, 1, 1, 1, light, 15)

  return { kind: 'watchtower', size, wallHeight, blocks: [...blocks.values()] }
}

function targetPoint (origin, block) {
  return {
    x: origin.x + Math.round(Number(block.dx) || 0),
    y: origin.y + Math.round(Number(block.dy) || 0),
    z: origin.z + Math.round(Number(block.dz) || 0)
  }
}

function distance3d (a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

class Builder {
  constructor (bot, rcon, config, memory, movement) {
    this.bot = bot
    this.rcon = rcon
    this.config = config
    this.memory = memory
    this.movement = movement
    this.active = null
    this.last = null
    this.lastEquipped = null
  }

  status () {
    return this.active ? { ...this.active } : this.last ? { ...this.last } : null
  }

  defaultOrigin () {
    const p = floorPos(this.bot.entity?.position)
    if (!p) throw new Error('bot position is unavailable')
    return { x: p.x + 4, y: p.y, z: p.z }
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

  isReplaceable (block) {
    return isAir(block) || SAFE_REPLACEABLE.has(blockName(block))
  }

  siteScore (origin, width, depth) {
    let supported = 0
    let clear = 0
    let total = 0
    for (let x = 0; x < width; x++) {
      for (let z = 0; z < depth; z++) {
        total++
        const target = blockAtCompat(this.bot, origin.x + x, origin.y, origin.z + z)
        const below = blockAtCompat(this.bot, origin.x + x, origin.y - 1, origin.z + z)
        if (this.isReplaceable(target)) clear++
        if (below && !isAir(below)) supported++
      }
    }
    return (clear / Math.max(1, total)) * 0.65 + (supported / Math.max(1, total)) * 0.35
  }

  findHouseOrigin (width, depth) {
    const p = floorPos(this.bot.entity?.position)
    if (!p) throw new Error('bot position is unavailable')
    const candidates = [
      { x: p.x + 4, y: p.y, z: p.z - Math.floor(depth / 2) },
      { x: p.x - width - 4, y: p.y, z: p.z - Math.floor(depth / 2) },
      { x: p.x - Math.floor(width / 2), y: p.y, z: p.z + 4 },
      { x: p.x - Math.floor(width / 2), y: p.y, z: p.z - depth - 4 }
    ]
      .filter(candidate => Math.hypot(candidate.x - p.x, candidate.z - p.z) <= this.config.maxDistance)
      .map(candidate => ({ candidate, score: this.siteScore(candidate, width, depth) }))
      .sort((a, b) => b.score - a.score)

    if (!candidates.length || candidates[0].score < this.config.minSiteScore) {
      const score = candidates[0]?.score ?? 0
      throw new Error(`no sufficiently flat nearby build site found (best score ${score.toFixed(2)}); walk to a flatter area`)
    }
    return candidates[0].candidate
  }

  validatePlan (origin, blocks) {
    if (!blocks.length) throw new Error('build contains no blocks')
    if (blocks.length > this.config.maxBlocks) {
      throw new Error(`build needs ${blocks.length} blocks; limit is ${this.config.maxBlocks}`)
    }

    const p = floorPos(this.bot.entity?.position)
    const furthest = Math.max(...blocks.map(block => distance3d(p, targetPoint(origin, block))))
    if (furthest > this.config.maxDistance) {
      throw new Error(`build extends ${furthest.toFixed(1)} blocks from Eva; limit is ${this.config.maxDistance}`)
    }

    for (const block of blocks) blockId(block.material)
  }

  inventoryItems () {
    try {
      if (typeof this.bot.inventory?.items === 'function') return this.bot.inventory.items()
      return Object.values(this.bot.inventory?.slots || {}).filter(Boolean)
    } catch {
      return []
    }
  }

  findInventoryItem (material) {
    const wanted = cleanBlockName(material)
    return this.inventoryItems().find(item => itemName(item) === wanted) || null
  }

  async ensureHeldMaterial (material) {
    const wanted = cleanBlockName(material)
    blockId(wanted)
    if (itemName(this.bot.heldItem) === wanted) {
      this.lastEquipped = wanted
      return
    }

    let item = this.findInventoryItem(wanted)
    if (!item && this.config.provisionWithRcon) {
      const username = String(this.bot.username || '').trim()
      if (!/^[A-Za-z0-9_]{1,32}$/.test(username)) throw new Error('cannot provision build material for invalid bot username')
      this.rcon.exec(`give ${username} ${blockId(wanted)} 64`)
      for (let i = 0; i < 8 && !item; i++) {
        await sleep(125)
        item = this.findInventoryItem(wanted)
      }
    }

    if (!item) throw new Error(`Eva does not have ${wanted}; RCON may provision inventory but never places build blocks`)
    if (typeof this.bot.equip !== 'function') throw new Error('Mineflayer equip API is unavailable')
    await this.bot.equip(item, 'hand')
    await sleep(40)
    this.lastEquipped = wanted
  }

  findReference (target) {
    const options = [
      { dx: 0, dy: -1, dz: 0, face: new Vec3(0, 1, 0) },
      { dx: 0, dy: 1, dz: 0, face: new Vec3(0, -1, 0) },
      { dx: -1, dy: 0, dz: 0, face: new Vec3(1, 0, 0) },
      { dx: 1, dy: 0, dz: 0, face: new Vec3(-1, 0, 0) },
      { dx: 0, dy: 0, dz: -1, face: new Vec3(0, 0, 1) },
      { dx: 0, dy: 0, dz: 1, face: new Vec3(0, 0, -1) }
    ]

    for (const option of options) {
      const block = blockAtCompat(this.bot, target.x + option.dx, target.y + option.dy, target.z + option.dz)
      if (block && !isAir(block)) return { block, face: option.face }
    }
    return null
  }

  bodyOccupies (target) {
    const p = floorPos(this.bot.entity?.position)
    if (!p) return false
    return p.x === target.x && p.z === target.z && (p.y === target.y || p.y + 1 === target.y)
  }

  targetReachDistance (target) {
    const p = this.bot.entity?.position
    if (!p) return Infinity
    return Math.hypot(target.x + 0.5 - p.x, target.y + 0.5 - (p.y + 1.62), target.z + 0.5 - p.z)
  }

  async moveIntoReach (target) {
    if (!this.movement) throw new Error('physical builder requires a movement controller')
    if (!this.bodyOccupies(target) && this.targetReachDistance(target) <= this.config.reach) return

    const current = this.bot.entity.position
    const candidates = [
      { x: target.x - 2.2, y: current.y, z: target.z + 0.5 },
      { x: target.x + 3.2, y: current.y, z: target.z + 0.5 },
      { x: target.x + 0.5, y: current.y, z: target.z - 2.2 },
      { x: target.x + 0.5, y: current.y, z: target.z + 3.2 }
    ].sort((a, b) => Math.hypot(a.x - current.x, a.z - current.z) - Math.hypot(b.x - current.x, b.z - current.z))

    let lastError = null
    for (const candidate of candidates) {
      try {
        await this.movement.walkTo(candidate, this.config.moveRange, this.config.moveMaxSeconds)
        if (!this.bodyOccupies(target) && this.targetReachDistance(target) <= this.config.reach + 0.5) return
      } catch (error) {
        lastError = error
      }
    }
    throw new Error(`could not walk into placement range${lastError ? `: ${lastError.message}` : ''}`)
  }

  async clearSafeReplaceable (target, existing) {
    const name = blockName(existing)
    if (isAir(existing)) return
    if (!SAFE_REPLACEABLE.has(name)) throw new Error(`target is occupied by ${name}`)
    if (typeof this.bot.dig !== 'function') throw new Error(`target contains ${name} and Mineflayer dig API is unavailable`)
    await this.moveIntoReach(target)
    await this.bot.dig(existing, true)
    await sleep(this.config.placementDelayMs)
  }

  async verifyPlaced (target, wanted) {
    for (let i = 0; i < 6; i++) {
      const current = blockAtCompat(this.bot, target.x, target.y, target.z)
      if (blockName(current) === wanted) return true
      await sleep(80)
    }
    return false
  }

  async tryPlace (origin, entry) {
    const target = targetPoint(origin, entry)
    const wanted = cleanBlockName(entry.material)
    let existing = blockAtCompat(this.bot, target.x, target.y, target.z)
    const existingName = blockName(existing)

    if (existingName === wanted) return { status: 'already', target }
    if (existing && !this.isReplaceable(existing)) return { status: 'occupied', target, existing: existingName }

    if (existing && !isAir(existing)) {
      try {
        await this.clearSafeReplaceable(target, existing)
        existing = blockAtCompat(this.bot, target.x, target.y, target.z)
      } catch (error) {
        return { status: 'failed', target, error: error.message }
      }
    }

    let reference = this.findReference(target)
    if (!reference) return { status: 'defer', target }

    try {
      await this.moveIntoReach(target)
      reference = this.findReference(target)
      if (!reference) return { status: 'defer', target }
      await this.ensureHeldMaterial(wanted)
      if (typeof this.bot.placeBlock !== 'function') throw new Error('Mineflayer placeBlock API is unavailable')
      await this.bot.placeBlock(reference.block, reference.face)
      await sleep(this.config.placementDelayMs)
      if (!(await this.verifyPlaced(target, wanted))) throw new Error(`placement was not confirmed as ${wanted}`)
      return { status: 'placed', target }
    } catch (error) {
      return { status: 'failed', target, error: error.message }
    }
  }

  async placePlan (origin, blocks, meta = {}) {
    const safeOrigin = this.validateOrigin(origin)
    this.validatePlan(safeOrigin, blocks)
    const ordered = [...blocks].sort((a, b) => (a.phase - b.phase) || (a.dy - b.dy) || (a.dz - b.dz) || (a.dx - b.dx))
    const phases = [...new Set(ordered.map(block => block.phase))]

    const stats = { placed: 0, already: 0, occupied: 0, failed: 0, deferred: 0 }
    this.active = {
      kind: meta.kind || 'build',
      origin: safeOrigin,
      total: ordered.length,
      done: 0,
      phase: phases[0] ?? 0,
      stats: { ...stats },
      startedAt: new Date().toISOString()
    }

    for (const phase of phases) {
      let pending = ordered.filter(block => block.phase === phase)
      this.active.phase = phase

      const staging = meta.phaseStaging?.[phase]
      if (staging && this.movement) {
        try {
          await this.movement.walkTo(staging, 1.1, this.config.moveMaxSeconds)
        } catch (error) {
          console.warn('[builder] could not reach phase staging point:', error.message)
        }
      }

      for (let pass = 0; pass < this.config.maxPlacementPasses && pending.length; pass++) {
        const here = this.bot.entity?.position
        if (here) {
          pending.sort((a, b) => {
            const pa = targetPoint(safeOrigin, a)
            const pb = targetPoint(safeOrigin, b)
            return Math.hypot(pa.x - here.x, pa.z - here.z) - Math.hypot(pb.x - here.x, pb.z - here.z)
          })
        }
        const next = []
        let resolvedThisPass = 0

        for (const entry of pending) {
          const result = await this.tryPlace(safeOrigin, entry)
          if (result.status === 'defer') {
            next.push(entry)
            continue
          }

          resolvedThisPass++
          stats[result.status] = (stats[result.status] || 0) + 1
          this.active.done++
          this.active.stats = { ...stats }

          if (result.status === 'failed') {
            console.warn('[builder] placement failed', result.target, result.error)
          } else if (result.status === 'occupied') {
            console.warn('[builder] skipped occupied target', result.target, result.existing)
          }
        }

        pending = next
        if (!resolvedThisPass) break
      }

      if (pending.length) {
        stats.deferred += pending.length
        this.active.done += pending.length
        this.active.stats = { ...stats }
      }
    }

    const result = {
      kind: meta.kind || 'build',
      origin: safeOrigin,
      total: ordered.length,
      ...stats,
      completedAt: new Date().toISOString()
    }
    this.last = result
    this.active = null

    if (stats.failed + stats.deferred > Math.max(3, Math.ceil(ordered.length * 0.12))) {
      throw new Error(`physical build incomplete: placed=${stats.placed}, already=${stats.already}, occupied=${stats.occupied}, failed=${stats.failed}, unsupported=${stats.deferred}`)
    }

    return result
  }

  rememberResult (result, extra = {}) {
    this.memory.rememberBuild({
      ...extra,
      origin: result.origin,
      blocks: result.total,
      placed: result.placed,
      already: result.already,
      occupied: result.occupied,
      failed: result.failed,
      unsupported: result.deferred,
      mode: 'physical_mineflayer'
    })
  }

  async buildPreset (name, material = 'cobblestone', origin = null) {
    const cleanName = String(name || '').toLowerCase()
    if (cleanName === 'hut') return this.buildHouse({ origin, width: 5, depth: 5, style: 'oak_cottage' })
    if (cleanName === 'tower') return this.buildWatchtower({ origin, size: 7 })

    const safeOrigin = this.validateOrigin(origin)
    const offsets = presetOffsets(cleanName)
    const blocks = offsets.map(([dx, dy, dz]) => makeBlock(dx, dy, dz, material, 10))
    const result = await this.placePlan(safeOrigin, blocks, { kind: `preset:${cleanName}` })
    this.rememberResult(result, { kind: 'preset', name: cleanName, material: blockId(material) })
    return `physically built ${cleanName}; ${result.placed} placed, ${result.already} already present, ${result.occupied} occupied targets skipped`
  }

  async buildBox (origin, material, width, height, depth, hollow = false) {
    const safeOrigin = this.validateOrigin(origin)
    const shape = boxOffsets(width, height, depth, Boolean(hollow))
    const blocks = shape.map(([dx, dy, dz]) => makeBlock(dx, dy, dz, material, 10))
    const result = await this.placePlan(safeOrigin, blocks, { kind: hollow ? 'hollow_box' : 'box' })
    this.rememberResult(result, {
      kind: hollow ? 'hollow_box' : 'box',
      material: blockId(material),
      width: Math.round(Number(width)),
      height: Math.round(Number(height)),
      depth: Math.round(Number(depth))
    })
    return `physically built ${hollow ? 'hollow ' : ''}box ${width}x${height}x${depth}; ${result.placed} blocks placed by Eva`
  }

  async buildShape (origin, material, blocks) {
    if (!Array.isArray(blocks)) throw new Error('blocks must be an array of [dx,dy,dz]')
    const safe = blocks
      .filter(v => Array.isArray(v) && v.length >= 3)
      .slice(0, this.config.maxBlocks)
      .map(([dx, dy, dz]) => makeBlock(dx, dy, dz, material, 10))
    const safeOrigin = this.validateOrigin(origin)
    const result = await this.placePlan(safeOrigin, safe, { kind: 'shape' })
    this.rememberResult(result, { kind: 'shape', material: blockId(material) })
    return `physically built custom shape; ${result.placed} blocks placed by Eva`
  }

  async buildHouse (options = {}) {
    const plan = houseBlueprint(options)
    const origin = options.origin ? this.validateOrigin(options.origin) : this.findHouseOrigin(plan.width, plan.depth)
    const cx = origin.x + Math.floor(plan.width / 2) + 0.5
    const cz = origin.z + Math.floor(plan.depth / 2) + 0.5
    const interior = { x: cx, y: origin.y, z: cz }
    const exterior = plan.front === 'north'
      ? { x: cx, y: origin.y, z: origin.z - 2 }
      : plan.front === 'east'
        ? { x: origin.x + plan.width + 2, y: origin.y, z: cz }
        : plan.front === 'west'
          ? { x: origin.x - 2, y: origin.y, z: cz }
          : { x: cx, y: origin.y, z: origin.z + plan.depth + 2 }
    const result = await this.placePlan(origin, plan.blocks, {
      kind: 'house',
      phaseStaging: { 20: exterior, 40: interior }
    })
    this.rememberResult(result, {
      kind: 'house',
      style: plan.style,
      width: plan.width,
      depth: plan.depth,
      wallHeight: plan.wallHeight,
      front: plan.front
    })
    return `physically built a ${plan.style} house ${plan.width}x${plan.depth} with floor, hollow walls, doorway, windows and roof; ${result.placed} blocks placed by Eva`
  }

  async buildWatchtower (options = {}) {
    const plan = watchtowerBlueprint(options)
    const origin = options.origin ? this.validateOrigin(options.origin) : this.findHouseOrigin(plan.size, plan.size)
    const center = origin.x + Math.floor(plan.size / 2) + 0.5
    const exterior = { x: center, y: origin.y, z: origin.z + plan.size + 2 }
    const interior = { x: center, y: origin.y, z: origin.z + Math.floor(plan.size / 2) + 0.5 }
    const result = await this.placePlan(origin, plan.blocks, {
      kind: 'watchtower',
      phaseStaging: { 20: exterior, 40: interior }
    })
    this.rememberResult(result, { kind: 'watchtower', size: plan.size, wallHeight: plan.wallHeight })
    return `physically built a ${plan.size}x${plan.size} watchtower with doorway, windows, deck and battlements; ${result.placed} blocks placed by Eva`
  }
}

module.exports = {
  Builder,
  ALLOWED_BLOCKS,
  HOUSE_STYLES,
  boxOffsets,
  houseBlueprint,
  watchtowerBlueprint
}
