#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
  EXPECTED_COUNT,
  EXPECTED_TAIL,
  extractPacketChain,
  verifyRegistry
} = require('./verify-26.2-registry')
const {
  packBlockPos,
  unpackBlockPos,
  toNetworkBytes,
  inspectReadBlockPos,
  selfTest
} = require('./verify-26.2-blockpos')
const {
  align,
  summarize
} = require('./diff-26.2-mappers')

const prefix = Array.from({ length: EXPECTED_COUNT - EXPECTED_TAIL.length }, (_, i) => `P${i}`)
const source = [...prefix, ...EXPECTED_TAIL]
  .map((name, i) => `${i % 5 === 0 ? 'CommonPacketTypes' : 'GamePacketTypes'}.${name}`)
  .join('.add(')

const extracted = extractPacketChain(source)
assert.strictEqual(extracted.length, EXPECTED_COUNT)
assert.deepStrictEqual(extracted.slice(-EXPECTED_TAIL.length), EXPECTED_TAIL)
assert.deepStrictEqual(verifyRegistry(extracted), [])

const broken = [...extracted]
broken[64] = 'WRONG_USE_ITEM_ON'
assert.ok(verifyRegistry(broken).some(error => /wire 64/.test(error)))

const exactTarget = [...extracted]
assert.deepStrictEqual(verifyRegistry(extracted, exactTarget), [])
const targetMismatch = [...exactTarget]
targetMismatch[12] = 'TARGET_ONLY'
assert.ok(verifyRegistry(extracted, targetMismatch).some(error => /diff at wire 12/.test(error)))

selfTest()
const packed = packBlockPos(40, 73, -67)
assert.deepStrictEqual(unpackBlockPos(packed), { x: 40, y: 73, z: -67 })
assert.strictEqual(toNetworkBytes(packed).length, 8)

const readSource = `
public BlockPos readBlockPos() {
  return BlockPos.of(this.readLong());
}
`
const readEvidence = inspectReadBlockPos(readSource)
assert.strictEqual(readEvidence.ok, true)
assert.ok(readEvidence.evidence.some(item => /64-bit long/.test(item)))

const wrongSource = `
public BlockPos readBlockPos() {
  return new BlockPos(this.readVarInt(), this.readVarInt(), this.readVarInt());
}
`
assert.strictEqual(inspectReadBlockPos(wrongSource).ok, false)

function row (id, name) {
  return { id, name, normalized: name }
}

const targetRows = ['A', 'B', 'C', 'D', 'E', 'F'].map((name, id) => row(id, name))
const pristineRows = ['A', 'X', 'B', 'C', 'Y', 'E', 'F'].map((name, id) => row(id, name))
const alignment = align(pristineRows, targetRows)
const alignmentSummary = summarize(alignment)
assert.strictEqual(pristineRows.length - targetRows.length, 1)
assert.strictEqual(alignmentSummary.extra.length - alignmentSummary.missing.length, 1)
assert.strictEqual(alignmentSummary.extra.length, 2)
assert.strictEqual(alignmentSummary.missing.length, 1)
assert.strictEqual(alignmentSummary.replaced.length, 0)

console.log('26.2 wire verifier tests OK')
