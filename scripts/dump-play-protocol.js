#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

function protocolRoot (document) {
  return document?.protocol && typeof document.protocol === 'object'
    ? document.protocol
    : document
}

function findNamedField (definition, name) {
  if (!Array.isArray(definition) || definition[0] !== 'container' || !Array.isArray(definition[1])) return null
  return definition[1].find(field => field?.name === name) || null
}

function extractPlayServerbound (document) {
  const root = protocolRoot(document)
  if (!root || typeof root !== 'object') throw new Error('protocol document root is not an object')

  const types = root.play?.toServer?.types
  if (!types || typeof types !== 'object') throw new Error('play.toServer.types is missing')

  const packet = types.packet
  const nameField = findNamedField(packet, 'name')
  const paramsField = findNamedField(packet, 'params')
  const mappings = nameField?.type?.[0] === 'mapper' ? nameField.type?.[1]?.mappings : null
  const params = paramsField?.type?.[0] === 'switch' ? paramsField.type?.[1]?.fields : null

  if (!mappings || typeof mappings !== 'object') throw new Error('play.toServer packet-name mapper is missing')
  if (!params || typeof params !== 'object') throw new Error('play.toServer packet params switch is missing')

  const entries = Object.entries(mappings)
    .map(([wireId, name]) => {
      const id = Number.parseInt(wireId, 16)
      const paramsType = params[name] || null
      return {
        id,
        hex: `0x${id.toString(16).padStart(2, '0')}`,
        name,
        paramsType,
        schema: paramsType ? (types[paramsType] ?? null) : null
      }
    })
    .sort((a, b) => a.id - b.id)

  return { count: entries.length, entries }
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

    let children
    try { children = fs.readdirSync(current, { withFileTypes: true }) } catch { continue }
    for (const child of children) {
      const full = path.join(current, child.name)
      if (child.isDirectory()) stack.push(full)
      else if (child.isFile() && child.name === 'protocol.json') results.push(full)
    }
  }

  return results
}

function addIfExists (set, candidate) {
  try {
    if (fs.statSync(candidate).isDirectory()) set.add(fs.realpathSync(candidate))
  } catch {}
}

function discoverFiles (repoRoot = path.resolve(__dirname, '..')) {
  const explicit = process.env.MINECRAFT_DATA_PROTOCOL_JSON
  if (explicit) return explicit.split(path.delimiter).filter(Boolean).map(file => path.resolve(file))

  const roots = new Set()
  addIfExists(roots, path.join(repoRoot, 'node_modules', 'minecraft-data'))

  try {
    const mineflayerPackage = require.resolve('mineflayer/package.json', { paths: [repoRoot] })
    const mineflayerRoot = path.dirname(mineflayerPackage)
    addIfExists(roots, path.join(mineflayerRoot, 'node_modules', 'minecraft-data'))
  } catch {}

  try {
    const dataEntry = require.resolve('minecraft-data', { paths: [repoRoot] })
    let current = path.dirname(dataEntry)
    while (current !== path.dirname(current)) {
      if (path.basename(current) === 'minecraft-data') {
        addIfExists(roots, current)
        break
      }
      current = path.dirname(current)
    }
  } catch {}

  return [...new Set([...roots].flatMap(collectProtocolFiles))]
}

function filesFromArgs (args, repoRoot) {
  const requested = args.filter(arg => !arg.startsWith('--'))
  if (!requested.length) return discoverFiles(repoRoot)

  const files = []
  for (const requestedPath of requested) {
    const resolved = path.resolve(requestedPath)
    const stat = fs.statSync(resolved)
    if (stat.isDirectory()) files.push(...collectProtocolFiles(resolved))
    else files.push(resolved)
  }
  return [...new Set(files)]
}

function focusEntries (entries) {
  const names = new Set(['block_place', 'use_item', 'custom_click_action'])
  return entries.filter(entry => names.has(entry.name) || (entry.id >= 0x36 && entry.id <= 0x42))
}

function renderText (filename, result) {
  const lines = []
  lines.push(`FILE ${filename}`)
  lines.push(`PLAY_SERVERBOUND_COUNT ${result.count}`)
  lines.push('DEC HEX  PACKET_NAME -> PARAMS_TYPE')
  for (const entry of result.entries) {
    lines.push(`${String(entry.id).padStart(3)} ${entry.hex} ${entry.name}${entry.paramsType ? ` -> ${entry.paramsType}` : ''}`)
  }

  lines.push('')
  lines.push('FOCUS_SCHEMAS')
  for (const entry of focusEntries(result.entries)) {
    lines.push(`${entry.hex} ${entry.name} -> ${entry.paramsType || '(none)'}`)
    if (entry.schema) lines.push(JSON.stringify(entry.schema, null, 2))
  }
  return lines.join('\n')
}

function inspectFiles (files) {
  const output = []
  for (const filename of files) {
    let document
    try {
      document = JSON.parse(fs.readFileSync(filename, 'utf8'))
    } catch (error) {
      output.push({ filename, error: `cannot parse JSON: ${error.message}` })
      continue
    }

    try {
      output.push({ filename, ...extractPlayServerbound(document) })
    } catch (error) {
      output.push({ filename, error: error.message })
    }
  }
  return output
}

function main () {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const repoRoot = path.resolve(__dirname, '..')

  try {
    const files = filesFromArgs(args, repoRoot)
    if (!files.length) throw new Error('no protocol.json found; pass a file/directory or set MINECRAFT_DATA_PROTOCOL_JSON')

    const results = inspectFiles(files)
    const usable = results.filter(result => !result.error)
    if (!usable.length) {
      for (const result of results) console.error(`${result.filename}: ${result.error}`)
      throw new Error('no readable play.toServer protocol mapper found')
    }

    if (json) {
      console.log(JSON.stringify(results, null, 2))
      return
    }

    for (const result of results) {
      if (result.error) console.error(`${result.filename}: ${result.error}`)
      else console.log(`${renderText(result.filename, result)}\n`)
    }
  } catch (error) {
    console.error(`[protocol-dump] ERROR: ${error.message}`)
    process.exitCode = 1
  }
}

if (require.main === module) main()

module.exports = {
  extractPlayServerbound,
  focusEntries,
  inspectFiles,
  renderText
}
