#!/usr/bin/env node
'use strict'

const fs = require('fs')

const XZ_MASK = (1n << 26n) - 1n
const Y_MASK = (1n << 12n) - 1n
const U64_MASK = (1n << 64n) - 1n

function signExtend (value, bits) {
  const sign = 1n << BigInt(bits - 1)
  const full = 1n << BigInt(bits)
  return (value & sign) ? value - full : value
}

function packBlockPos (x, y, z) {
  const xb = BigInt(x) & XZ_MASK
  const yb = BigInt(y) & Y_MASK
  const zb = BigInt(z) & XZ_MASK
  return ((xb << 38n) | (zb << 12n) | yb) & U64_MASK
}

function unpackBlockPos (packed) {
  const value = BigInt(packed) & U64_MASK
  return {
    x: Number(signExtend((value >> 38n) & XZ_MASK, 26)),
    y: Number(signExtend(value & Y_MASK, 12)),
    z: Number(signExtend((value >> 12n) & XZ_MASK, 26))
  }
}

function toNetworkBytes (packed) {
  let value = BigInt(packed) & U64_MASK
  const bytes = Buffer.alloc(8)
  for (let i = 7; i >= 0; i--) {
    bytes[i] = Number(value & 0xffn)
    value >>= 8n
  }
  return bytes
}

function findMethodBody (source, methodName) {
  const marker = `${methodName}(`
  const index = source.indexOf(marker)
  if (index < 0) return null
  const open = source.indexOf('{', index)
  if (open < 0) return null

  let depth = 0
  let inString = null
  let escaped = false
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = ch
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  return null
}

function inspectReadBlockPos (source) {
  const body = findMethodBody(source, 'readBlockPos')
  if (body == null) {
    return { ok: false, body: null, evidence: [], errors: ['readBlockPos(...) method not found'] }
  }

  const evidence = []
  const errors = []
  const hasReadLong = /\breadLong\s*\(\s*\)/.test(body)
  const hasBlockPosDecode = /\bBlockPos\s*\.\s*(?:of|fromLong)\s*\(/.test(body)

  if (hasReadLong) evidence.push('readBlockPos reads one 64-bit long')
  else errors.push('readBlockPos body does not call readLong()')

  if (hasBlockPosDecode) evidence.push('readBlockPos decodes via BlockPos.of/fromLong')
  else errors.push('readBlockPos body does not call BlockPos.of(...) or BlockPos.fromLong(...)')

  return { ok: errors.length === 0, body, evidence, errors }
}

function selfTest () {
  const cases = [
    [0, 0, 0],
    [40, 73, -67],
    [-1, -1, -1],
    [33554431, 2047, 33554431],
    [-33554432, -2048, -33554432]
  ]
  for (const [x, y, z] of cases) {
    const decoded = unpackBlockPos(packBlockPos(x, y, z))
    if (decoded.x !== x || decoded.y !== y || decoded.z !== z) {
      throw new Error(`BlockPos round-trip failed for ${x},${y},${z}: ${JSON.stringify(decoded)}`)
    }
  }
}

function usage () {
  console.log('Usage:')
  console.log('  node scripts/verify-26.2-blockpos.js --source FriendlyByteBuf.java')
  console.log('  node scripts/verify-26.2-blockpos.js --coords X Y Z')
  console.log('  node scripts/verify-26.2-blockpos.js --long 0x0123456789abcdef')
}

function main () {
  selfTest()
  const args = process.argv.slice(2)

  if (args[0] === '--source' && args[1]) {
    const source = fs.readFileSync(args[1], 'utf8')
    const result = inspectReadBlockPos(source)
    if (result.body != null) console.log(result.body.trim())
    console.log('')
    for (const item of result.evidence) console.log(`OK: ${item}`)
    for (const item of result.errors) console.error(`ERROR: ${item}`)
    if (result.ok) console.log('26.2 BlockPos source evidence supports packed signed X26/Z26/Y12 in one network long.')
    else process.exitCode = 1
    return
  }

  if (args[0] === '--coords' && args.length >= 4) {
    const x = Number(args[1])
    const y = Number(args[2])
    const z = Number(args[3])
    const packed = packBlockPos(x, y, z)
    console.log(`packed=0x${packed.toString(16).padStart(16, '0')}`)
    console.log(`bytes=${toNetworkBytes(packed).toString('hex')}`)
    console.log(JSON.stringify(unpackBlockPos(packed)))
    return
  }

  if (args[0] === '--long' && args[1]) {
    const packed = BigInt(args[1])
    console.log(JSON.stringify(unpackBlockPos(packed)))
    return
  }

  usage()
}

if (require.main === module) {
  try { main() } catch (error) {
    console.error(`26.2 BlockPos verifier ERROR: ${error.message}`)
    process.exitCode = 1
  }
}

module.exports = {
  packBlockPos,
  unpackBlockPos,
  toNetworkBytes,
  findMethodBody,
  inspectReadBlockPos,
  selfTest
}
