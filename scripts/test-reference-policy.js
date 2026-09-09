#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { isSafePlacementReference } = require('../src/reference-policy')

assert.strictEqual(isSafePlacementReference(null), false)
assert.strictEqual(isSafePlacementReference({ name: 'air', boundingBox: 'empty', shapes: [] }), false)
assert.strictEqual(isSafePlacementReference({
  name: 'leaf_litter',
  boundingBox: 'block',
  shapes: [[0, 0, 0, 1, 0.0625, 1]]
}), false)
assert.strictEqual(isSafePlacementReference({
  name: 'white_carpet',
  boundingBox: 'block',
  shapes: [[0, 0, 0, 1, 0.0625, 1]]
}), false)
assert.strictEqual(isSafePlacementReference({
  name: 'stone',
  boundingBox: 'block',
  shapes: [[0, 0, 0, 1, 1, 1]]
}), true)
assert.strictEqual(isSafePlacementReference({
  name: 'grass_block',
  boundingBox: 'block',
  shapes: [[0, 0, 0, 1, 1, 1]]
}), true)
assert.strictEqual(isSafePlacementReference({
  name: 'stone_slab',
  boundingBox: 'block',
  shapes: [[0, 0, 0, 1, 0.5, 1]]
}), true)

console.log('placement reference policy tests OK')
