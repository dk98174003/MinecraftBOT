'use strict'

const { Vec3 } = require('vec3')
const { Builder } = require('./building')
const { blockAtCompat } = require('./world')
const { isSafePlacementReference } = require('./reference-policy')

class PhysicalBuilder extends Builder {
  findReference (target) {
    const options = [
      { dx: 0, dy: -1, dz: 0, face: new Vec3(0, 1, 0) },
      { dx: 0, dy: 1, dz: 0, face: new Vec3(0, -1, 0) },
      { dx: -1, dy: 0, dz: 0, face: new Vec3(1, 0, 0) },
      { dx: 1, dy: 0, dz: 0, face: new Vec3(-1, 0, 0) },
      { dx: 0, dy: 0, dz: -1, face: new Vec3(0, 0, 1) },
      { dx: 0, dy: 0, dz: 1, face: new Vec3(0, 0, -1) }
    ]

    for (const option of options) {
      const block = blockAtCompat(
        this.bot,
        target.x + option.dx,
        target.y + option.dy,
        target.z + option.dz
      )
      if (isSafePlacementReference(block)) return { block, face: option.face }
    }
    return null
  }
}

module.exports = { PhysicalBuilder }
