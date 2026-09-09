'use strict'

const NEVER_REFERENCE = new Set([
  'leaf_litter',
  'short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'vine',
  'snow', 'snow_layer', 'redstone_wire', 'tripwire',
  'torch', 'wall_torch', 'soul_torch', 'soul_wall_torch'
])

function cleanName (block) {
  return String(block?.name || block?.displayName || block?.type || '')
    .replace(/^minecraft:/, '')
    .trim()
    .toLowerCase()
}

function isDecorativeName (name) {
  return NEVER_REFERENCE.has(name) ||
    name.endsWith('_carpet') ||
    name.endsWith('_sapling') ||
    name.endsWith('_button') ||
    name.endsWith('_pressure_plate') ||
    name.endsWith('_rail') ||
    name.endsWith('_flower') ||
    name.endsWith('_tulip') ||
    name.endsWith('_mushroom')
}

function hasSubstantialCollisionShape (block) {
  const shapes = Array.isArray(block?.shapes) ? block.shapes : []
  if (!shapes.length) return block?.boundingBox === 'block'

  return shapes.some(shape => {
    if (!Array.isArray(shape) || shape.length < 6) return false
    const width = Number(shape[3]) - Number(shape[0])
    const height = Number(shape[4]) - Number(shape[1])
    const depth = Number(shape[5]) - Number(shape[2])
    return width >= 0.5 && height >= 0.5 && depth >= 0.5
  })
}

function isSafePlacementReference (block) {
  if (!block) return false
  const name = cleanName(block)
  if (!name || name === 'air' || name === 'cave_air' || name === 'void_air') return false
  if (block.boundingBox === 'empty') return false
  if (isDecorativeName(name)) return false
  return hasSubstantialCollisionShape(block)
}

module.exports = {
  isSafePlacementReference,
  hasSubstantialCollisionShape
}
