#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { extractPlayServerbound, focusEntries } = require('./dump-play-protocol')

function fixture () {
  const mappings = {
    '0x38': 'set_creative_slot',
    '0x39': 'set_game_rule',
    '0x3a': 'update_jigsaw_block',
    '0x3b': 'update_structure_block',
    '0x3c': 'set_test_block',
    '0x3d': 'sign_update',
    '0x3e': 'spectator_action',
    '0x3f': 'arm_animation',
    '0x40': 'teleport_to_entity',
    '0x41': 'test_instance_block_action',
    '0x42': 'block_place',
    '0x43': 'use_item',
    '0x44': 'custom_click_action'
  }

  const fields = Object.fromEntries(Object.values(mappings).map(name => [name, `packet_${name}`]))
  const types = Object.fromEntries(Object.values(fields).map(type => [type, ['container', []]]))

  return {
    play: {
      toServer: {
        types: {
          ...types,
          packet: ['container', [
            {
              name: 'name',
              type: ['mapper', { type: 'varint', mappings }]
            },
            {
              name: 'params',
              type: ['switch', { compareTo: 'name', fields }]
            }
          ]]
        }
      }
    }
  }
}

const result = extractPlayServerbound(fixture())
assert.strictEqual(result.count, 13)
assert.strictEqual(result.entries[0].id, 0x38)
assert.strictEqual(result.entries.at(-1).id, 0x44)

const place = result.entries.find(entry => entry.name === 'block_place')
assert.ok(place)
assert.strictEqual(place.id, 0x42)
assert.strictEqual(place.paramsType, 'packet_block_place')
assert.deepStrictEqual(place.schema, ['container', []])

const teleport = result.entries.find(entry => entry.name === 'teleport_to_entity')
assert.ok(teleport)
assert.strictEqual(teleport.id, 0x40)

const focused = focusEntries(result.entries)
assert.ok(focused.some(entry => entry.name === 'block_place'))
assert.ok(focused.some(entry => entry.name === 'custom_click_action'))

const wrapped = { protocol: fixture() }
assert.strictEqual(extractPlayServerbound(wrapped).entries.find(entry => entry.name === 'use_item').id, 0x43)

assert.throws(() => extractPlayServerbound({}), /play\.toServer\.types is missing/)

console.log('protocol dump tests OK')
