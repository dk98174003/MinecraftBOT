const { Vec3 } = require('vec3')
const { blockAtCompat, isAir } = require('./world')

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function distance2d (a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

class MovementController {
  constructor (bot, config) {
    this.bot = bot
    this.config = config
  }

  stop () {
    for (const control of ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']) {
      try { this.bot.setControlState(control, false) } catch {}
    }
  }

  async lookAtPoint (target) {
    const y = Number.isFinite(target.y) ? target.y : this.bot.entity.position.y
    await this.bot.lookAt(new Vec3(target.x, y + 1.4, target.z), true)
  }

  groundDepthAhead (target) {
    const p = this.bot.entity.position
    const dx = target.x - p.x
    const dz = target.z - p.z
    const mag = Math.max(0.001, Math.hypot(dx, dz))
    const sx = Math.round(p.x + dx / mag)
    const sz = Math.round(p.z + dz / mag)
    const feetY = Math.floor(p.y)

    let depth = 0
    for (let i = 1; i <= this.config.maxDrop + 1; i++) {
      const block = blockAtCompat(this.bot, sx, feetY - i, sz)
      if (block && !isAir(block)) return depth
      depth++
    }
    return depth
  }

  obstacleAhead (target) {
    const p = this.bot.entity.position
    const dx = target.x - p.x
    const dz = target.z - p.z
    const mag = Math.max(0.001, Math.hypot(dx, dz))
    const x = Math.round(p.x + dx / mag)
    const z = Math.round(p.z + dz / mag)
    const y = Math.floor(p.y)

    const feet = blockAtCompat(this.bot, x, y, z)
    const head = blockAtCompat(this.bot, x, y + 1, z)
    return !isAir(feet) || !isAir(head)
  }

  async jump () {
    this.bot.setControlState('jump', true)
    await sleep(420)
    this.bot.setControlState('jump', false)
    return 'jumped'
  }

  async walkTo (target, range = 2, maxSeconds = this.config.maxSeconds) {
    if (!this.bot.entity?.position) throw new Error('bot has no entity position')

    const goal = {
      x: Number(target.x),
      y: Number(target.y ?? this.bot.entity.position.y),
      z: Number(target.z)
    }
    if (![goal.x, goal.y, goal.z].every(Number.isFinite)) throw new Error('invalid walk target')

    const maxMs = Math.max(1000, Math.min(this.config.maxSeconds * 1000, Number(maxSeconds) * 1000))
    const deadline = Date.now() + maxMs
    let best = distance2d(this.bot.entity.position, goal)
    let stuckTicks = 0

    try {
      while (Date.now() < deadline) {
        const current = this.bot.entity.position
        const distance = distance2d(current, goal)
        if (distance <= Math.max(1, Number(range) || 2)) {
          return `walked to within ${distance.toFixed(1)} blocks of ${Math.round(goal.x)},${Math.round(goal.y)},${Math.round(goal.z)}`
        }

        await this.lookAtPoint(goal)

        const drop = this.groundDepthAhead(goal)
        if (drop > this.config.maxDrop) {
          throw new Error(`stopped at unsafe drop (${drop}+ blocks)`)
        }

        if (this.obstacleAhead(goal)) {
          this.bot.setControlState('jump', true)
        } else {
          this.bot.setControlState('jump', false)
        }

        this.bot.setControlState('forward', true)
        this.bot.setControlState('sprint', distance > 5)
        await sleep(this.config.stepMs)

        const nextDistance = distance2d(this.bot.entity.position, goal)
        if (nextDistance < best - 0.15) {
          best = nextDistance
          stuckTicks = 0
        } else {
          stuckTicks++
        }

        if (stuckTicks >= Math.ceil(1500 / this.config.stepMs)) {
          await this.jump()
          stuckTicks = 0
        }
      }
    } finally {
      this.stop()
    }

    const left = distance2d(this.bot.entity.position, goal)
    return `movement time cap reached; ${left.toFixed(1)} blocks remain`
  }

  async walkToPlayer (name, range = 2) {
    const entity = this.bot.players?.[name]?.entity
    if (!entity?.position) throw new Error(`player ${name} is not currently visible`)
    return this.walkTo(entity.position, range)
  }

  async wander (radius = 10) {
    const p = this.bot.entity.position
    const r = Math.max(4, Math.min(24, Number(radius) || 10))
    const angle = Math.random() * Math.PI * 2
    return this.walkTo({
      x: p.x + Math.cos(angle) * r,
      y: p.y,
      z: p.z + Math.sin(angle) * r
    }, 2)
  }
}

module.exports = { MovementController, sleep }
