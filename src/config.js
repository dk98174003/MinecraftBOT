function boolEnv (name, fallback) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  return /^(1|true|yes|on)$/i.test(raw)
}

function intEnv (name, fallback, min, max) {
  const n = Number.parseInt(process.env[name] ?? '', 10)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function numEnv (name, fallback, min, max) {
  const n = Number(process.env[name])
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function csv (value) {
  return String(value || '').split(',').map(v => v.trim()).filter(Boolean)
}

function point (value, fallback = null) {
  const parts = String(value || '').split(',').map(Number)
  if (parts.length !== 3 || parts.some(v => !Number.isFinite(v))) return fallback
  return { x: parts[0], y: parts[1], z: parts[2] }
}

module.exports = {
  mc: {
    host: process.env.MC_HOST || '127.0.0.1',
    port: intEnv('MC_PORT', 25565, 1, 65535),
    username: process.env.MC_USERNAME || 'Ronja',
    auth: process.env.MC_AUTH || 'offline',
    version: process.env.MC_VERSION || '26.2'
  },
  llm: {
    baseUrl: (process.env.LLM_BASE_URL || 'http://192.168.0.65:8000/v1').replace(/\/+$/, ''),
    model: process.env.LLM_MODEL || 'qwen38-27b',
    apiKey: process.env.LLM_API_KEY || 'EMPTY',
    timeoutMs: intEnv('LLM_TIMEOUT_MS', 60000, 5000, 180000),
    temperature: numEnv('LLM_TEMPERATURE', 0.45, 0, 2)
  },
  agent: {
    autonomous: boolEnv('AGENT_AUTONOMOUS', true),
    tickMs: intEnv('AGENT_TICK_MS', 5000, 2500, 60000),
    maxActions: intEnv('AGENT_MAX_ACTIONS', 4, 1, 8),
    maxHistory: intEnv('AGENT_MAX_HISTORY', 24, 8, 80),
    admins: new Set(csv(process.env.AGENT_ADMIN_USERS || 'dk98174003')),
    home: point(process.env.HOME_POSITION, { x: 54, y: 108, z: 34 })
  },
  movement: {
    maxSeconds: intEnv('MOVE_MAX_SECONDS', 8, 1, 30),
    stepMs: intEnv('MOVE_STEP_MS', 250, 100, 1000),
    maxDrop: intEnv('MOVE_MAX_DROP', 3, 1, 8)
  },
  rcon: {
    enabled: boolEnv('RCON_ENABLED', true),
    container: process.env.RCON_CONTAINER || 'minecraft',
    host: process.env.RCON_HOST || '127.0.0.1',
    port: intEnv('RCON_PORT', 25575, 1, 65535),
    password: process.env.RCON_PASSWORD || '',
    propertiesPaths: csv(process.env.RCON_PROPERTIES_PATHS ||
      '/data/minecraft_data/server.properties,/data/server.properties,/server.properties,/minecraft/server.properties')
  },
  build: {
    maxBlocks: intEnv('BUILD_MAX_BLOCKS', 600, 10, 2000),
    maxDistance: intEnv('BUILD_MAX_DISTANCE', 32, 8, 128)
  }
}
