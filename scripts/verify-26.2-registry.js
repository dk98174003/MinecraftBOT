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
const RECOGNIZED_PREFIXES = new Set(['GamePacketTypes', 'CommonPacketTypes'])

function readInput (filename) {
  if (filename && filename !== '-') return fs.readFileSync(filename, 'utf8')
  return fs.readFileSync(0, 'utf8')
}

function findMatchingParen (source, openIndex) {
  let depth = 0
  let quote = null
  let escaped = false

  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i]
    const next = source[i + 1]

    if (quote) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) quote = null
      continue
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }

    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i + 2)
      if (end === -1) return -1
      i = end
      continue
    }

    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      if (end === -1) return -1
      i = end + 1
      continue
    }

    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
  }

  return -1
}

function firstTopLevelArgument (body) {
  let paren = 0
  let bracket = 0
  let brace = 0
  let quote = null
  let escaped = false

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quote) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '(') paren++
    else if (ch === ')') paren--
    else if (ch === '[') bracket++
    else if (ch === ']') bracket--
    else if (ch === '{') brace++
    else if (ch === '}') brace--
    else if (ch === ',' && paren === 0 && bracket === 0 && brace === 0) return body.slice(0, i).trim()
  }

  return body.trim()
}

function extractAddPacketCalls (source) {
  const calls = []
  const re = /\baddPacket\s*\(/g
  let match

  while ((match = re.exec(source)) !== null) {
    const openIndex = source.indexOf('(', match.index)
    const closeIndex = findMatchingParen(source, openIndex)
    if (closeIndex < 0) {
      calls.push({ index: match.index, raw: source.slice(match.index), firstArg: null, malformed: true })
      break
    }

    const body = source.slice(openIndex + 1, closeIndex)
    calls.push({
      index: match.index,
      raw: source.slice(match.index, closeIndex + 1),
      firstArg: firstTopLevelArgument(body),
      malformed: false
    })
    re.lastIndex = closeIndex + 1
  }

  return calls
}

function classifyAddPacketCall (call) {
  if (call.malformed || !call.firstArg) {
    return { ...call, prefix: null, name: null, recognized: false, reason: 'malformed addPacket call' }
  }

  const refs = [...call.firstArg.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*PacketTypes)\.([A-Z0-9_]+)\b/g)]
  if (refs.length !== 1) {
    return {
      ...call,
      prefix: refs[0]?.[1] || null,
      name: refs[0]?.[2] || null,
      recognized: false,
      reason: refs.length === 0 ? 'first argument has no *PacketTypes.NAME reference' : `first argument has ${refs.length} packet type references`
    }
  }

  const prefix = refs[0][1]
  const name = refs[0][2]
  return {
    ...call,
    prefix,
    name,
    recognized: RECOGNIZED_PREFIXES.has(prefix),
    reason: RECOGNIZED_PREFIXES.has(prefix) ? null : `unrecognized packet type prefix ${prefix}`
  }
}

function auditRegistrations (source) {
  const calls = extractAddPacketCalls(source).map(classifyAddPacketCall)
  const recognized = calls.filter(call => call.recognized)
  const outliers = calls.filter(call => !call.recognized)
  return {
    rawAddPacketCount: calls.length,
    calls,
    recognized,
    outliers,
    packets: recognized.map(call => call.name)
  }
}

function extractPacketChain (source) {
  return auditRegistrations(source).packets
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

function verifyRegistry (packets, target = null, audit = null) {
  const errors = []

  if (audit) {
    if (audit.rawAddPacketCount !== EXPECTED_COUNT) {
      errors.push(`expected exactly ${EXPECTED_COUNT} addPacket registrations, found ${audit.rawAddPacketCount}`)
    }
    if (audit.outliers.length) {
      for (const outlier of audit.outliers) {
        const preview = (outlier.firstArg || outlier.raw || '').replace(/\s+/g, ' ').trim().slice(0, 180)
        errors.push(`unclassified addPacket at source offset ${outlier.index}: ${outlier.reason}; firstArg=${preview || '<empty>'}`)
      }
    }
    if (audit.recognized.length !== audit.rawAddPacketCount) {
      errors.push(`only ${audit.recognized.length}/${audit.rawAddPacketCount} addPacket calls use GamePacketTypes/CommonPacketTypes`)
    }
  }

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

function formatAudit (audit) {
  const lines = [
    `raw addPacket calls=${audit.rawAddPacketCount}`,
    `recognized Game/Common registrations=${audit.recognized.length}`,
    `unclassified/outlier registrations=${audit.outliers.length}`
  ]
  for (const outlier of audit.outliers) {
    lines.push(`- offset ${outlier.index}: ${outlier.reason}; ${String(outlier.firstArg || outlier.raw || '').replace(/\s+/g, ' ').trim().slice(0, 220)}`)
  }
  return lines.join('\n')
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
  const audit = auditRegistrations(source)
  const packets = audit.packets
  const target = targetFile ? parseTarget(fs.readFileSync(targetFile, 'utf8')) : null
  const errors = verifyRegistry(packets, target, audit)

  if (json) {
    console.log(JSON.stringify({
      count: packets.length,
      rawAddPacketCount: audit.rawAddPacketCount,
      packets,
      outliers: audit.outliers.map(({ index, firstArg, prefix, name, reason }) => ({ index, firstArg, prefix, name, reason })),
      errors
    }, null, 2))
  } else {
    console.log(formatChain(packets))
    console.log(`\n${formatAudit(audit)}`)
    if (errors.length) {
      console.error('\n26.2 registry verification FAILED:')
      for (const error of errors) console.error(`- ${error}`)
    } else {
      console.log('\n26.2 registry verification OK: every addPacket call is accounted for')
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
  RECOGNIZED_PREFIXES,
  extractAddPacketCalls,
  classifyAddPacketCall,
  auditRegistrations,
  extractPacketChain,
  parseTarget,
  verifyRegistry,
  formatChain,
  formatAudit
}
