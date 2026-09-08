const fs = require('fs')
const path = require('path')

class MemoryStore {
  constructor (filename = path.join(process.cwd(), 'agent-memory.json')) {
    this.filename = filename
    this.data = this.load()
  }

  load () {
    try {
      const value = JSON.parse(fs.readFileSync(this.filename, 'utf8'))
      return {
        notes: Array.isArray(value.notes) ? value.notes : [],
        builds: Array.isArray(value.builds) ? value.builds : [],
        players: value.players && typeof value.players === 'object' ? value.players : {}
      }
    } catch {
      return { notes: [], builds: [], players: {} }
    }
  }

  save () {
    const temp = `${this.filename}.tmp`
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2) + '\n')
    fs.renameSync(temp, this.filename)
  }

  remember (note) {
    const text = String(note || '').replace(/\s+/g, ' ').trim().slice(0, 400)
    if (!text) return
    this.data.notes.push({ note: text, at: new Date().toISOString() })
    this.data.notes = this.data.notes.slice(-100)
    this.save()
  }

  rememberPlayer (name, message) {
    this.data.players[name] = {
      lastSeen: new Date().toISOString(),
      lastMessage: String(message || '').slice(0, 300)
    }
    this.save()
  }

  rememberBuild (build) {
    this.data.builds.push({ ...build, at: new Date().toISOString() })
    this.data.builds = this.data.builds.slice(-60)
    this.save()
  }

  context () {
    return {
      notes: this.data.notes.slice(-12),
      builds: this.data.builds.slice(-8),
      players: Object.fromEntries(Object.entries(this.data.players).slice(-20))
    }
  }
}

module.exports = { MemoryStore }
