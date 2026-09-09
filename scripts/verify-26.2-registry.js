#!/usr/bin/env node
'use strict'

const fs = require('fs')

const EXPECTED_COUNT = 67
const EXPECTED_TAIL = Object.freeze([
  'SPECTATOR_ACTION',
  'SWING',
  'TELEPORT_TO_ENTITY',
  'TEST_INSTANCE_BLOCK_ACTION',
  'USE_ITEM_ON',
  'USE_ITEM',
  'CUSTOM_CLICK_ACTION'
])

function readInput (filename) {
  if (filename && filename !== '-') return fs.readFileSync(filename, 'utf8')
  return fs.readFileSync(0, 'utf8')
}

function extractPacketChain (source) {
  const packets = []
  const re = /\b(?:GamePacketTypes|CommonPacketTypes)\.([A-Z0-9_]+)\b/g
  let match
  while ((match = re.exec(source)) !== null) packets.push(match[1])
  return packets
}

function parseTarget (text) {
  const names = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(?:(?:0x[0-9a-f]+|\d+)\s+)?([A-Z][A-Z0-9_]*)$/i)
    if (!match) throw new Error(`cannot parse target line: ${raw}`)
    names.push(match[1].toUpperCase())
  }
  return names
}

function verifyRegistry (packets, target = null) {
  const errors = []

  if (packets.length !== EXPECTED_COUNT) {
    errors.push(`expected ${EXPECTED_COUNT} packets, extracted ${packets.length}`)
  }

  const tailStart = EXPECTED_COUNT - EXPECTED_TAIL.length
  for (let i = 0; i < EXPECTED_TAIL.length; i++) {
    const id = tailStart + i
    if (packets[id] !== EXPECTED_TAIL[i]) {
      errors.push(`wire ${id} (0x${id.toString(16)}): expected ${EXPECTED_TAIL[i]}, got ${packets[id] ?? '<missing>'}`)
    }
  }

  if (target) {
    if (target.length !== EXPECTED_COUNT) {
      errors.push(`target must contain ${EXPECTED_COUNT} packets, got ${target.length}`)
    }
    const max = Math.max(packets.length, target.length)
    for (let i = 0; i < max; i++) {
      if (packets[i] !== target[i]) {
        errors.push(`diff at wire ${i} (0x${i.toString(16)}): target=${target[i] ?? '<missing>'}, extracted=${packets[i] ?? '<missing>'}`)
      }
    }
  }

  return errors
}

function formatChain (packets) {
  return packets.map((name, id) => `${String(id).padStart(2)} 0x${id.toString(16).padStart(2, '0')} ${name}`).join('\n')
}

function main () {
  const args = process.argv.slice(2)
  let sourceFile = null
  let targetFile = null
  let json = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--target') targetFile = args[++i]
    else if (arg === '--json') json = true
    else if (!sourceFile) sourceFile = arg
    else throw new Error(`unexpected argument: ${arg}`)
  }

  const source = readInput(sourceFile)
  const packets = extractPacketChain(source)
  const target = targetFile ? parseTarget(fs.readFileSync(targetFile, 'utf8')) : null
  const errors = verifyRegistry(packets, target)

  if (json) {
    console.log(JSON.stringify({ count: packets.length, packets, errors }, null, 2))
  } else {
    console.log(formatChain(packets))
    console.log(`\ncount=${packets.length}`)
    if (errors.length) {
      console.error('\n26.2 registry verification FAILED:')
      for (const error of errors) console.error(`- ${error}`)
    } else {
      console.log('26.2 registry verification OK')
    }
  }

  if (errors.length) process.exitCode = 1
}

if (require.main === module) {
  try { main() } catch (error) {
    console.error(`26.2 registry verifier ERROR: ${error.message}`)
    process.exitCode = 1
  }
}

module.exports = {
  EXPECTED_COUNT,
  EXPECTED_TAIL,
  extractPacketChain,
  parseTarget,
  verifyRegistry,
  formatChain
}
