#!/usr/bin/env node
'use strict'

const fs = require('fs')

// Known Mojang <-> Prismarine naming differences. This is deliberately small;
// unknown names stay distinct so the diff cannot hide a real protocol mismatch.
const ALIASES = Object.freeze({
  ARM_ANIMATION: 'SWING',
  BLOCK_PLACE: 'USE_ITEM_ON',
  SET_CREATIVE_SLOT: 'SET_CREATIVE_MODE_SLOT',
  UPDATE_SIGN: 'SIGN_UPDATE',
  SPECTATE: 'TELEPORT_TO_ENTITY',
  SPECTATE_ENTITY: 'SPECTATOR_ACTION',
  UPDATE_STRUCTURE_BLOCK: 'SET_STRUCTURE_BLOCK'
})

function normalizeName (name) {
  const upper = String(name)
    .replace(/^packet_/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
  return ALIASES[upper] || upper
}

function parseTarget (text) {
  const rows = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    let match = line.match(/^(\d+)\s+(?:0x[0-9a-f]+\s+)?([A-Za-z0-9_]+)$/i)
    if (!match) match = line.match(/^(?:0x[0-9a-f]+\s+)?([A-Za-z0-9_]+)$/i)
    if (!match) throw new Error(`cannot parse target line: ${raw}`)
    const id = match.length === 3 ? Number(match[1]) : rows.length
    const name = match.length === 3 ? match[2] : match[1]
    rows.push({ id, name, normalized: normalizeName(name) })
  }
  rows.sort((a, b) => a.id - b.id)
  return rows
}

function parsePristineDump (text) {
  const parsed = JSON.parse(text)
  let packets = parsed.packets || parsed.entries || parsed
  if (!Array.isArray(packets)) throw new Error('pristine dump JSON must contain a packets/entries array')
  return packets.map((packet, index) => {
    if (typeof packet === 'string') return { id: index, name: packet, normalized: normalizeName(packet) }
    const id = Number(packet.id ?? packet.decimal ?? packet.wireId ?? index)
    const name = packet.name ?? packet.packet ?? packet.type
    if (!name) throw new Error(`missing packet name at pristine index ${index}`)
    return { id, name, normalized: normalizeName(name) }
  }).sort((a, b) => a.id - b.id)
}

// Levenshtein-style sequence alignment. Insert/delete cost 1; substitution 2,
// which strongly prefers exposing phantom entries instead of relabeling every
// subsequent packet after an insertion.
function align (pristine, target) {
  const n = pristine.length
  const m = target.length
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  const op = Array.from({ length: n + 1 }, () => Array(m + 1).fill(null))

  for (let i = 1; i <= n; i++) { dp[i][0] = i; op[i][0] = 'extra' }
  for (let j = 1; j <= m; j++) { dp[0][j] = j; op[0][j] = 'missing' }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const same = pristine[i - 1].normalized === target[j - 1].normalized
      const choices = [
        { cost: dp[i - 1][j - 1] + (same ? 0 : 2), kind: same ? 'match' : 'replace' },
        { cost: dp[i - 1][j] + 1, kind: 'extra' },
        { cost: dp[i][j - 1] + 1, kind: 'missing' }
      ]
      choices.sort((a, b) => a.cost - b.cost || ['match', 'extra', 'missing', 'replace'].indexOf(a.kind) - ['match', 'extra', 'missing', 'replace'].indexOf(b.kind))
      dp[i][j] = choices[0].cost
      op[i][j] = choices[0].kind
    }
  }

  const rows = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    const kind = op[i][j]
    if (kind === 'match' || kind === 'replace') {
      rows.push({ kind, pristine: pristine[i - 1], target: target[j - 1] })
      i--; j--
    } else if (kind === 'extra') {
      rows.push({ kind, pristine: pristine[i - 1], target: null })
      i--
    } else if (kind === 'missing') {
      rows.push({ kind, pristine: null, target: target[j - 1] })
      j--
    } else {
      throw new Error(`alignment backtrack failed at ${i},${j}`)
    }
  }

  return { cost: dp[n][m], rows: rows.reverse() }
}

function formatRow (row) {
  const p = row.pristine ? `${String(row.pristine.id).padStart(2)} ${row.pristine.name}` : '-- <missing>'
  const t = row.target ? `${String(row.target.id).padStart(2)} ${row.target.name}` : '-- <none>'
  const marker = row.kind === 'match' ? ' ' : row.kind === 'extra' ? '+' : row.kind === 'missing' ? '-' : '!'
  return `${marker} pristine: ${p.padEnd(38)} target: ${t}`
}

function summarize (result) {
  const extra = result.rows.filter(row => row.kind === 'extra')
  const missing = result.rows.filter(row => row.kind === 'missing')
  const replaced = result.rows.filter(row => row.kind === 'replace')
  const firstDiff = result.rows.find(row => row.kind !== 'match') || null
  return { extra, missing, replaced, firstDiff }
}

function main () {
  const args = process.argv.slice(2)
  const pristineFile = args[0]
  const targetFile = args[1]
  const json = args.includes('--json')
  if (!pristineFile || !targetFile) {
    throw new Error('usage: node scripts/diff-26.2-mappers.js pristine-dump.json authoritative-target.txt [--json]')
  }

  const pristine = parsePristineDump(fs.readFileSync(pristineFile, 'utf8'))
  const target = parseTarget(fs.readFileSync(targetFile, 'utf8'))
  const result = align(pristine, target)
  const summary = summarize(result)

  if (json) {
    console.log(JSON.stringify({
      pristineCount: pristine.length,
      targetCount: target.length,
      cost: result.cost,
      extra: summary.extra,
      missing: summary.missing,
      replaced: summary.replaced,
      firstDiff: summary.firstDiff,
      rows: result.rows
    }, null, 2))
  } else {
    console.log(`pristine=${pristine.length} target=${target.length} alignmentCost=${result.cost}`)
    for (const row of result.rows) {
      if (row.kind !== 'match') console.log(formatRow(row))
    }
    console.log(`\nextra=${summary.extra.length} missing=${summary.missing.length} replaced=${summary.replaced.length}`)
    if (summary.firstDiff) console.log(`first divergence: ${formatRow(summary.firstDiff)}`)
  }

  // For the currently observed defect the clean result must be exactly one
  // extra pristine entry (68 vs 67) unless new evidence says otherwise.
  if (pristine.length === 68 && target.length === 67 && summary.extra.length !== 1) {
    console.error(`WARNING: expected one extra pristine packet from counts alone, alignment found ${summary.extra.length}; inspect replacements/missing entries before patching.`)
    process.exitCode = 2
  }
}

if (require.main === module) {
  try { main() } catch (error) {
    console.error(`26.2 mapper diff ERROR: ${error.message}`)
    process.exitCode = 1
  }
}

module.exports = { ALIASES, normalizeName, parseTarget, parsePristineDump, align, summarize }
