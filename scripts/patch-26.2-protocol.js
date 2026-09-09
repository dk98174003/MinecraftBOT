#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

function protocolRoot (document) {
  return document?.protocol && typeof document.protocol === 'object' ? document.protocol : document
}

function findNamedField (definition, name) {
  if (!Array.isArray(definition) || definition[0] !== 'container' || !Array.isArray(definition[1])) return null
  return definition[1].find(field => field?.name === name) || null
}

function mapperParts (document) {
  const root = protocolRoot(document)
  const types = root?.play?.toServer?.types
  if (!types) return null

  const packet = types.packet
  const nameField = findNamedField(packet, 'name')
  const paramsField = findNamedField(packet, 'params')
  const mappings = nameField?.type?.[0] === 'mapper' ? nameField.type?.[1]?.mappings : null
  const params = paramsField?.type?.[0] === 'switch' ? paramsField.type?.[1]?.fields : null
  if (!mappings || !params) return null
  return { types, mappings, params }
}

function normalizeHex (id) {
  return `0x${id.toString(16)}`
}

function idOf (mappings, name) {
  for (const [wire, packetName] of Object.entries(mappings)) {
    if (packetName === name) return Number.parseInt(wire, 16)
  }
  return null
}

function patchDocument (document) {
  const parts = mapperParts(document)
  if (!parts) return { changed: false, reason: 'not a play-serverbound protocol document' }

  const { mappings, params } = parts
  const count = Object.keys(mappings).length
  const placeId = idOf(mappings, 'block_place')
  const useItemId = idOf(mappings, 'use_item')
  const clickId = idOf(mappings, 'custom_click_action')

  if (count === 69 && placeId === 0x42 && useItemId === 0x43 && clickId === 0x44) {
    return { changed: false, reason: 'already corrected' }
  }

  if (!(count === 68 && placeId === 0x41 && useItemId === 0x42 && clickId === 0x43)) {
    return {
      changed: false,
      reason: `signature mismatch (count=${count}, block_place=${placeId}, use_item=${useItemId}, custom_click_action=${clickId})`
    }
  }

  const entries = Object.entries(mappings)
    .map(([wire, name]) => [Number.parseInt(wire, 16), name])
    .sort((a, b) => b[0] - a[0])

  for (const [id, name] of entries) {
    if (id < 0x40) continue
    delete mappings[normalizeHex(id)]
    mappings[normalizeHex(id + 1)] = name
  }
  mappings['0x40'] = 'teleport_to_entity'

  // The pristine fork is missing the mapper entry. Reuse a compatible schema
  // alias only when the data set already exposes one; placement itself does
  // not depend on this packet's schema.
  if (!params.teleport_to_entity) {
    if (params.spectate) params.teleport_to_entity = params.spectate
    else if (parts.types.packet_teleport_to_entity) params.teleport_to_entity = 'packet_teleport_to_entity'
  }

  const corrected = {
    count: Object.keys(mappings).length,
    teleportToEntity: idOf(mappings, 'teleport_to_entity'),
    blockPlace: idOf(mappings, 'block_place'),
    useItem: idOf(mappings, 'use_item'),
    customClickAction: idOf(mappings, 'custom_click_action')
  }

  if (corrected.count !== 69 || corrected.teleportToEntity !== 0x40 || corrected.blockPlace !== 0x42 || corrected.useItem !== 0x43 || corrected.customClickAction !== 0x44) {
    throw new Error(`post-patch validation failed: ${JSON.stringify(corrected)}`)
  }

  return { changed: true, corrected }
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

function discoverFiles (repoRoot) {
  if (process.env.MINECRAFT_DATA_PROTOCOL_JSON) {
    return process.env.MINECRAFT_DATA_PROTOCOL_JSON.split(path.delimiter).filter(Boolean).map(file => path.resolve(file))
  }

  const roots = new Set()
  const candidates = [path.join(repoRoot, 'node_modules', 'minecraft-data')]
  try {
    const mineflayerPackage = require.resolve('mineflayer/package.json', { paths: [repoRoot] })
    candidates.push(path.join(path.dirname(mineflayerPackage), 'node_modules', 'minecraft-data'))
  } catch {}

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isDirectory()) roots.add(fs.realpathSync(candidate))
    } catch {}
  }

  return [...new Set([...roots].flatMap(collectProtocolFiles))]
}

function patchFile (filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const document = JSON.parse(source)
  const result = patchDocument(document)
  if (result.changed) {
    fs.writeFileSync(filename, `${JSON.stringify(document, null, 2)}\n`)
  }
  return result
}

function main () {
  const repoRoot = path.resolve(__dirname, '..')
  const requested = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
  const files = requested.length ? requested.map(file => path.resolve(file)) : discoverFiles(repoRoot)
  if (!files.length) throw new Error('no protocol.json found; install dependencies or set MINECRAFT_DATA_PROTOCOL_JSON')

  let changed = 0
  let corrected = 0
  for (const filename of files) {
    let result
    try { result = patchFile(filename) } catch (error) {
      console.error(`[26.2-protocol] ${filename}: ERROR ${error.message}`)
      continue
    }
    if (result.changed) {
      changed++
      corrected++
      console.log(`[26.2-protocol] patched ${filename}: teleport_to_entity=0x40 block_place=0x42 use_item=0x43 custom_click_action=0x44`)
    } else if (result.reason === 'already corrected') {
      corrected++
      console.log(`[26.2-protocol] already corrected ${filename}`)
    }
  }

  if (!corrected) throw new Error(`no matching Minecraft 26.2 mapper found among ${files.length} protocol file(s)`)
  console.log(`[26.2-protocol] OK (${changed} changed, ${corrected} corrected mapper(s))`)
}

if (require.main === module) {
  try { main() } catch (error) {
    console.error(`[26.2-protocol] ERROR: ${error.message}`)
    process.exitCode = 1
  }
}

module.exports = { patchDocument, idOf, mapperParts }
