#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { extractPlayServerbound, focusEntries } = require('./dump-play-protocol')

function fixture () {
  const mappings = {
    '0x36': 'set_creative_slot',
    '0x37': 'set_game_rule',
    '0x38': 'update_jigsaw_block',
    '0x39': 'update_structure_block',
    '0x3a': 'set_test_block',
    '0x3b': 'update_sign',
    '0x3c': 'spectate_entity',
    '0x3d': 'arm_animation',
    '0x3e': 'spectate',
    '0x3f': 'test_instance_block_action',
    '0x40': 'block_place',
    '0x41': 'use_item',
    '0x42': 'custom_click_action'
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
assert.strictEqual(result.entries[0].id, 0x36)
assert.strictEqual(result.entries.at(-1).id, 0x42)

const place = result.entries.find(entry => entry.name === 'block_place')
assert.ok(place)
assert.strictEqual(place.id, 0x40)
assert.strictEqual(place.paramsType, 'packet_block_place')
assert.deepStrictEqual(place.schema, ['container', []])

const focused = focusEntries(result.entries)
assert.ok(focused.some(entry => entry.name === 'block_place'))
assert.ok(focused.some(entry => entry.name === 'custom_click_action'))
assert.ok(focused.every(entry => entry.id >= 0x36 && entry.id <= 0x42))

const wrapped = { protocol: fixture() }
assert.strictEqual(extractPlayServerbound(wrapped).entries.find(entry => entry.name === 'use_item').id, 0x41)

assert.throws(() => extractPlayServerbound({}), /play\.toServer\.types is missing/)

console.log('protocol dump tests OK')
