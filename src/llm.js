function stripThinking (text) {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

function parseJsonObject (text) {
  const raw = stripThinking(text)
  try { return JSON.parse(raw) } catch {}

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()) } catch {}
  }

  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1))
  throw new Error('LLM response did not contain a valid JSON object')
}

class LlmClient {
  constructor (config) {
    this.config = config
    this.model = config.model
  }

  async fetchJson (url, options = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)

    try {
      const response = await fetch(url, { ...options, signal: controller.signal })
      const text = await response.text()
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`)
      return JSON.parse(text)
    } finally {
      clearTimeout(timer)
    }
  }

  async resolveModel () {
    if (this.model) return this.model
    const data = await this.fetchJson(`${this.config.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.config.apiKey}` }
    })
    this.model = data?.data?.[0]?.id
    if (!this.model) throw new Error('no model returned by /v1/models')
    return this.model
  }

  async decide (systemPrompt, state) {
    const model = await this.resolveModel()
    const data = await this.fetchJson(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: this.config.temperature,
        max_tokens: 1400,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(state) }
        ]
      })
    })

    const content = data?.choices?.[0]?.message?.content
    if (!content) throw new Error('LLM returned no message content')
    return parseJsonObject(content)
  }
}

module.exports = { LlmClient, parseJsonObject }
