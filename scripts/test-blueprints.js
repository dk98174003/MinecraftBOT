const assert = require('assert')
const { boxOffsets, houseBlueprint, watchtowerBlueprint } = require('../src/building')

function at (plan, x, y, z) {
  return plan.blocks.find(block => block.dx === x && block.dy === y && block.dz === z)
}

const house = houseBlueprint({
  width: 7,
  depth: 7,
  wallHeight: 3,
  front: 'south',
  style: 'stone_cottage'
})

assert.strictEqual(house.blocks.length, 209)
assert.strictEqual(at(house, 3, 1, 6), undefined, 'door lower block must remain empty')
assert.strictEqual(at(house, 3, 2, 6), undefined, 'door upper block must remain empty')
assert.strictEqual(at(house, 3, 1, 3), undefined, 'house interior must remain hollow')
assert.strictEqual(at(house, 2, 2, 6)?.material, 'glass', 'front window should be glass')
assert.strictEqual(at(house, 0, 1, 0)?.material, 'oak_log', 'corners should use structural trim')
assert.strictEqual(at(house, -1, 4, -1)?.material, 'dark_oak_planks', 'roof should overhang the walls')
assert.strictEqual(at(house, 3, 5, 3)?.material, 'dark_oak_planks', 'roof should have a raised ridge')
assert.strictEqual(at(house, 1, 1, 1)?.material, 'lantern', 'house should contain lighting')

assert.throws(
  () => boxOffsets(7, 7, 7, false),
  /large solid cuboid/,
  'large solid cubes must be rejected'
)

const tower = watchtowerBlueprint({ size: 7, wallHeight: 3 })
assert.strictEqual(at(tower, 3, 1, 6), undefined, 'tower must have a doorway')
assert.strictEqual(at(tower, 3, 2, 0)?.material, 'glass', 'tower should have windows')
assert.strictEqual(at(tower, 0, 5, 0)?.material, 'stone_bricks', 'tower should have battlements')

console.log(`Blueprint tests OK: house=${house.blocks.length} blocks, tower=${tower.blocks.length} blocks`)
