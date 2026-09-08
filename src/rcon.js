const fs = require('fs')
const { execFileSync, spawnSync } = require('child_process')

class Rcon {
  constructor (config) {
    this.config = config
    this.cachedPassword = null
  }

  findPassword () {
    if (this.config.password) return this.config.password
    if (this.cachedPassword) return this.cachedPassword

    for (const file of this.config.propertiesPaths) {
      try {
        const text = fs.readFileSync(file, 'utf8')
        const line = text.split(/\r?\n/).find(v => v.startsWith('rcon.password='))
        const password = line?.slice('rcon.password='.length).trim()
        if (password) {
          this.cachedPassword = password
          return password
        }
      } catch {
        // Try the next known server.properties location.
      }
    }
    return null
  }

  exec (command, timeoutMs = 180000) {
    if (!this.config.enabled) throw new Error('RCON is disabled')
    const password = this.findPassword()
    if (!password) throw new Error('RCON password was not found')

    const args = [
      'exec', this.config.container,
      'rcon-cli',
      '--host', this.config.host,
      '--port', String(this.config.port),
      '--password', password,
      String(command)
    ]

    try {
      return execFileSync('docker', args, {
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe']
      }).trim()
    } catch (error) {
      const stderr = String(error.stderr || '').trim()
      throw new Error(`RCON command failed: ${(stderr || error.message).slice(0, 300)}`)
    }
  }

  execMany (commands, timeoutMs = 180000) {
    if (!this.config.enabled) throw new Error('RCON is disabled')
    const password = this.findPassword()
    if (!password) throw new Error('RCON password was not found')

    const list = (Array.isArray(commands) ? commands : [commands])
      .map(command => String(command || '').trim())
      .filter(Boolean)
    if (!list.length) return ''

    const args = [
      'exec', '-i', this.config.container,
      'rcon-cli',
      '--host', this.config.host,
      '--port', String(this.config.port),
      '--password', password
    ]

    const result = spawnSync('docker', args, {
      input: `${list.join('\n')}\n`,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024
    })

    if (result.error) throw new Error(`RCON batch failed: ${result.error.message}`)
    if (result.status !== 0) {
      throw new Error(`RCON batch failed: ${String(result.stderr || result.stdout || '').trim().slice(0, 300)}`)
    }
    return String(result.stdout || '').trim()
  }

  say (speaker, message) {
    const clean = String(message || '').replace(/\s+/g, ' ').trim().slice(0, 240)
    if (!clean) return
    const component = [
      { text: `${speaker}: `, color: 'light_purple', bold: true },
      { text: clean, color: 'white' }
    ]
    this.exec(`tellraw @a ${JSON.stringify(component)}`)
  }
}

module.exports = { Rcon }
