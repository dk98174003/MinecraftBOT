#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
  EXPECTED_CUSTOM_CLICK_SCHEMA,
  patchDocument
} = require('./patch-protocol-776')

function clone (value) {
  return JSON.parse(JSON.stringify(value))
}

function fixture ({ fixed = false, badSchema = false } = {}) {
  const mappings = {
    '0x2c': 'player_loaded',
    '0x39': 'set_game_rule',
    '0x3c': 'set_test_block',
    '0x3f': 'arm_animation',
    '0x40': 'spectate',
    ...(fixed
      ? {
          '0x41': 'test_instance_block_action',
          '0x42': 'block_place',
          '0x43': 'use_item',
          '0x44': 'custom_click_action'
        }
      : {
          '0x41': 'block_place',
          '0x42': 'use_item',
          '0x43': 'custom_click_action'
        })
  }

  return {
    types: {
      packet_common_custom_click_action: badSchema
        ? ['container', [{ name: 'id', type: 'string' }]]
        : clone(EXPECTED_CUSTOM_CLICK_SCHEMA)
    },
    play: {
      toServer: {
        types: {
          packet: ['container', [
            {
              name: 'name',
              type: ['mapper', { type: 'varint', mappings }]
            }
          ]]
        }
      }
    }
  }
}

const broken = fixture()
const first = patchDocument(broken)
assert.deepStrictEqual(first, { applicable: true, changed: true })
const mappings = broken.play.toServer.types.packet[1][0].type[1].mappings
assert.strictEqual(mappings['0x41'], 'test_instance_block_action')
assert.strictEqual(mappings['0x42'], 'block_place')
assert.strictEqual(mappings['0x43'], 'use_item')
assert.strictEqual(mappings['0x44'], 'custom_click_action')

const second = patchDocument(broken)
assert.deepStrictEqual(second, { applicable: true, changed: false })
assert.doesNotThrow(() => patchDocument(broken, { checkOnly: true }))

assert.throws(
  () => patchDocument(fixture(), { checkOnly: true }),
  /off-by-one/
)
assert.throws(
  () => patchDocument(fixture({ badSchema: true })),
  /schema differs/
)
assert.deepStrictEqual(patchDocument({ types: {} }), { applicable: false, changed: false })

// The original failed patch expected a wrapper. Keep wrapper support too, while
// explicitly proving that the real raw-root document is the primary fixture.
const wrapped = { protocol: fixture() }
assert.deepStrictEqual(patchDocument(wrapped), { applicable: true, changed: true })

console.log('protocol patch tests OK')
