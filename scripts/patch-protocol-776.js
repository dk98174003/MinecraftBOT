#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const EXPECTED_TAIL = Object.freeze({
  '0x41': 'test_instance_block_action',
  '0x42': 'block_place',
  '0x43': 'use_item',
  '0x44': 'custom_click_action'
})

const EXPECTED_CUSTOM_CLICK_SCHEMA = Object.freeze([
  'container',
  [
    { name: 'id', type: 'string' },
    { name: 'nbt', type: ['option', 'anonymousNbt'] }
  ]
])

const PROTOCOL_SENTINELS = new Set([
  'player_loaded',
  'set_game_rule',
  'set_test_block',
  'block_place',
  'use_item',
  'custom_click_action'
])

const PATCHED_NAMES = new Set(Object.values(EXPECTED_TAIL))

function sameJson (a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function walkObjects (value, visit, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  visit(value)
  if (Array.isArray(value)) {
    for (const item of value) walkObjects(item, visit, seen)
  } else {
    for (const item of Object.values(value)) walkObjects(item, visit, seen)
  }
}

function packetMapCandidates (root) {
  const found = []
  walkObjects(root, node => {
    const mappings = node?.mappings
    if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) return
    const values = new Set(Object.values(mappings))
    if ([...PROTOCOL_SENTINELS].every(name => values.has(name))) found.push(mappings)
  })
  return found
}

function idFor (mappings, packetName) {
  const pair = Object.entries(mappings).find(([, value]) => value === packetName)
  return pair?.[0] || null
}

function inspectTail (mappings) {
  const arm = idFor(mappings, 'arm_animation')
  const spectate = idFor(mappings, 'spectate')
  const blockPlace = idFor(mappings, 'block_place')
  const useItem = idFor(mappings, 'use_item')
  const customClick = idFor(mappings, 'custom_click_action')
  const testInstance = idFor(mappings, 'test_instance_block_action')

  if (arm !== '0x3f' || spectate !== '0x40') {
    throw new Error(`unexpected protocol tail prefix: arm_animation=${arm}, spectate=${spectate}`)
  }

  const fixed = blockPlace === '0x42' && useItem === '0x43' && customClick === '0x44' && testInstance === '0x41'
  const offByOne = blockPlace === '0x41' && useItem === '0x42' && customClick === '0x43' && testInstance == null

  if (!fixed && !offByOne) {
    throw new Error(
      `unexpected protocol tail: test_instance=${testInstance}, block_place=${blockPlace}, use_item=${useItem}, custom_click_action=${customClick}`
    )
  }

  return { fixed, offByOne }
}

function patchDocument (document, { checkOnly = false } = {}) {
  const root = document?.protocol && typeof document.protocol === 'object'
    ? document.protocol
    : document

  if (!root || typeof root !== 'object') throw new Error('protocol document root is not an object')

  const candidates = packetMapCandidates(root)
  if (candidates.length === 0) return { applicable: false, changed: false }
  if (candidates.length !== 1) throw new Error(`expected one 26.x serverbound packet mapper, found ${candidates.length}`)

  const schema = root.types?.packet_common_custom_click_action
  if (!sameJson(schema, EXPECTED_CUSTOM_CLICK_SCHEMA)) {
    throw new Error('custom_click_action schema differs from vanilla-776 (expected id:string + optional anonymous NBT)')
  }

  const mappings = candidates[0]
  const state = inspectTail(mappings)
  if (state.fixed) return { applicable: true, changed: false }
  if (checkOnly) throw new Error('protocol 776 tail still has the known off-by-one block_place mapping')

  for (const [id, name] of Object.entries(mappings)) {
    if (PATCHED_NAMES.has(name)) delete mappings[id]
  }
  Object.assign(mappings, EXPECTED_TAIL)

  const verified = inspectTail(mappings)
  if (!verified.fixed) throw new Error('protocol tail verification failed after patch')
  return { applicable: true, changed: true }
}

function atomicWriteJson (filename, document) {
  const temp = `${filename}.tmp-${process.pid}`
  fs.writeFileSync(temp, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  fs.renameSync(temp, filename)
}

function collectProtocolFiles (rootDir) {
  const results = []
  const stack = [rootDir]
  const seen = new Set()

  while (stack.length) {
    const current = stack.pop()
    let real
    try { real = fs.realpathSync(current) } catch { continue }
    if (seen.has(real)) continue
    seen.add(real)

    let stat
    try { stat = fs.statSync(current) } catch { continue }
    if (!stat.isDirectory()) continue

    let entries
    try { entries = fs.readdirSync(current, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile() && entry.name === 'protocol.json') results.push(full)
    }
  }

  return results
}

function addExistingRoot (roots, candidate) {
  try {
    if (fs.statSync(candidate).isDirectory()) roots.add(fs.realpathSync(candidate))
  } catch {}
}

function minecraftDataRoots (repoRoot) {
  const roots = new Set()
  const explicit = process.env.MINECRAFT_DATA_PROTOCOL_JSON
  if (explicit) return { explicitFiles: explicit.split(path.delimiter).filter(Boolean), roots: [] }

  // npm normally hoists minecraft-data here. Keep direct-path fallbacks because
  // package.json exports can make require.resolve('minecraft-data/package.json')
  // unavailable even when the package is installed correctly.
  addExistingRoot(roots, path.join(repoRoot, 'node_modules', 'minecraft-data'))

  const resolveFrom = [repoRoot]
  try {
    const mineflayerPackage = require.resolve('mineflayer/package.json', { paths: [repoRoot] })
    const mineflayerRoot = path.dirname(mineflayerPackage)
    resolveFrom.push(mineflayerRoot)
    addExistingRoot(roots, path.join(mineflayerRoot, 'node_modules', 'minecraft-data'))
  } catch {}

  for (const base of resolveFrom) {
    try {
      const pkg = require.resolve('minecraft-data/package.json', { paths: [base] })
      roots.add(path.dirname(pkg))
    } catch {}
    try {
      const entry = require.resolve('minecraft-data', { paths: [base] })
      let current = path.dirname(entry)
      while (current !== path.dirname(current)) {
        if (path.basename(current) === 'minecraft-data') {
          addExistingRoot(roots, current)
          break
        }
        current = path.dirname(current)
      }
    } catch {}
  }

  return { explicitFiles: [], roots: [...roots] }
}

function patchInstalledData ({ checkOnly = false, repoRoot = path.resolve(__dirname, '..') } = {}) {
  const { explicitFiles, roots } = minecraftDataRoots(repoRoot)
  const files = explicitFiles.length
    ? explicitFiles.map(file => path.resolve(file))
    : [...new Set(roots.flatMap(collectProtocolFiles))]

  if (!files.length) {
    throw new Error('could not locate installed minecraft-data protocol.json files; run npm install first or set MINECRAFT_DATA_PROTOCOL_JSON')
  }

  const applicable = []
  for (const filename of files) {
    let document
    try { document = JSON.parse(fs.readFileSync(filename, 'utf8')) } catch { continue }
    const result = patchDocument(document, { checkOnly })
    if (!result.applicable) continue

    applicable.push(filename)
    if (result.changed) {
      atomicWriteJson(filename, document)
      const verifyDoc = JSON.parse(fs.readFileSync(filename, 'utf8'))
      patchDocument(verifyDoc, { checkOnly: true })
      console.log(`[protocol-776] patched ${filename}`)
    } else {
      console.log(`[protocol-776] verified ${filename}`)
    }
  }

  if (!applicable.length) {
    throw new Error('no installed protocol document matched the Minecraft 26.x/vanilla-776 serverbound schema')
  }

  return applicable
}

function main () {
  const checkOnly = process.argv.includes('--check')
  try {
    patchInstalledData({ checkOnly })
    console.log(`[protocol-776] ${checkOnly ? 'verification' : 'patch/verification'} complete`)
  } catch (error) {
    console.error(`[protocol-776] ERROR: ${error.message}`)
    process.exitCode = 1
  }
}

if (require.main === module) main()

module.exports = {
  EXPECTED_TAIL,
  EXPECTED_CUSTOM_CLICK_SCHEMA,
  inspectTail,
  patchDocument,
  patchInstalledData
}
