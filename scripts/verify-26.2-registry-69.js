#!/usr/bin/env node
'use strict'

const fs = require('fs')
const { extractAddPacketCalls } = require('./verify-26.2-registry')

const EXPECTED_COUNT = 69
const EXPECTED_TAIL = Object.freeze([
  'SIGN_UPDATE',
  'SPECTATOR_ACTION',
  'SWING',
  'TELEPORT_TO_ENTITY',
  'TEST_INSTANCE_BLOCK_ACTION',
  'USE_ITEM_ON',
  'USE_ITEM',
  'CUSTOM_CLICK_ACTION'
])
const RECOGNIZED_PREFIXES = new Set([
  'GamePacketTypes',
  'CommonPacketTypes',
  'CookiePacketTypes',
  'PingPacketTypes'
])

function classify (call) {
  const refs = [...String(call.firstArg || '').matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*PacketTypes)\.([A-Z0-9_]+)\b/g)]
  if (call.malformed || refs.length !== 1) return { ...call, recognized: false, reason: 'cannot identify exactly one packet type' }
  const prefix = refs[0][1]
  const name = refs[0][2]
  return { ...call, prefix, name, recognized: RECOGNIZED_PREFIXES.has(prefix), reason: RECOGNIZED_PREFIXES.has(prefix) ? null : `unrecognized prefix ${prefix}` }
}

function verifySource (source) {
  const calls = extractAddPacketCalls(source).map(classify)
  const errors = []
  if (calls.length !== EXPECTED_COUNT) errors.push(`expected ${EXPECTED_COUNT} addPacket registrations, found ${calls.length}`)

  const outliers = calls.filter(call => !call.recognized)
  for (const outlier of outliers) errors.push(`unclassified addPacket at offset ${outlier.index}: ${outlier.reason}`)

  const packets = calls.filter(call => call.recognized).map(call => call.name)
  if (packets.length !== EXPECTED_COUNT) errors.push(`expected ${EXPECTED_COUNT} recognized packets, found ${packets.length}`)

  const tailStart = EXPECTED_COUNT - EXPECTED_TAIL.length
  for (let i = 0; i < EXPECTED_TAIL.length; i++) {
    const id = tailStart + i
    if (packets[id] !== EXPECTED_TAIL[i]) errors.push(`wire ${id} (0x${id.toString(16)}): expected ${EXPECTED_TAIL[i]}, got ${packets[id] || '<missing>'}`)
  }

  if (packets[0x15] !== 'COOKIE_RESPONSE') errors.push(`wire 0x15: expected COOKIE_RESPONSE, got ${packets[0x15] || '<missing>'}`)
  if (packets[0x26] !== 'PING_REQUEST') errors.push(`wire 0x26: expected PING_REQUEST, got ${packets[0x26] || '<missing>'}`)
  if (packets[0x42] !== 'USE_ITEM_ON') errors.push(`wire 0x42: expected USE_ITEM_ON, got ${packets[0x42] || '<missing>'}`)

  return { calls, packets, errors }
}

function main () {
  const filename = process.argv[2]
  const source = filename && filename !== '-' ? fs.readFileSync(filename, 'utf8') : fs.readFileSync(0, 'utf8')
  const result = verifySource(source)
  result.packets.forEach((name, id) => console.log(`${String(id).padStart(2)} 0x${id.toString(16).padStart(2, '0')} ${name}`))
  if (result.errors.length) {
    console.error('\n26.2 registry verification FAILED:')
    result.errors.forEach(error => console.error(`- ${error}`))
    process.exitCode = 1
  } else {
    console.log('\n26.2 registry verification OK: 69 entries, USE_ITEM_ON=0x42')
  }
}

if (require.main === module) main()

module.exports = { EXPECTED_COUNT, EXPECTED_TAIL, RECOGNIZED_PREFIXES, verifySource }
