// ai-draw background worker (iframe sandbox, always-on)
;(function () {
  const api = window.fastWindow
  const SETTINGS_KEY = 'settings'
  const SAVED_RESULTS_KEY = 'bgSavedResults'
  const POLL_INTERVAL = 1200
  const MAX_SAVED_RESULTS = 200

  let ticking = false

  function stripCodeFences(s) {
    const raw = String(s || '').trim()
    if (!raw) return ''
    if (raw.startsWith('```')) {
      const i = raw.indexOf('\n')
      const j = raw.lastIndexOf('```')
      if (i >= 0 && j > i) return raw.slice(i + 1, j).trim()
    }
    return raw
  }

  function extractImageFromText(text) {
    const s = String(text || '').trim()
    if (!s) return ''

    const dataUrlMatch = s.match(/data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\r\n]+/i)
    if (dataUrlMatch && dataUrlMatch[0]) return dataUrlMatch[0]

    const maybeJson = stripCodeFences(s)
    try {
      const j = JSON.parse(maybeJson)
      const dataUrl = j?.data_url || j?.dataUrl || j?.image || j?.image_data_url
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) return dataUrl.trim()
      const b64 = j?.b64_png || j?.b64_json || j?.b64 || j?.base64 || j?.image_base64 || j?.png_base64
      if (typeof b64 === 'string' && b64.trim()) return `data:image/png;base64,${b64.trim()}`
    } catch {}

    if (/^[A-Za-z0-9+/=\r\n]+$/.test(s) && s.length > 200) {
      return `data:image/png;base64,${s.replace(/\s+/g, '')}`
    }

    return ''
  }

  function parseTaskImageData(task) {
    const result = task && task.result && typeof task.result === 'object' ? task.result : {}
    const httpStatus = Number(result.status)
    if (!Number.isFinite(httpStatus) || httpStatus < 200 || httpStatus >= 300) return ''

    const bodyText = typeof result.body === 'string' ? result.body : ''
    let parsed = null
    try {
      parsed = JSON.parse(String(bodyText || '{}'))
    } catch {
      parsed = null
    }

    if (!parsed || typeof parsed !== 'object') {
      return extractImageFromText(bodyText)
    }

    const item = (Array.isArray(parsed?.data) && parsed.data[0]) || (Array.isArray(parsed?.images) && parsed.images[0]) || null
    const b64 = item?.b64_json || item?.b64 || item?.base64 || ''
    const direct = typeof item?.data_url === 'string' ? item.data_url : typeof item?.dataUrl === 'string' ? item.dataUrl : ''
    const content =
      (Array.isArray(parsed?.choices) && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content) || ''

    return (
      (direct && String(direct).trim()) ||
      (b64 && `data:image/png;base64,${String(b64).trim()}`) ||
      extractImageFromText(content)
    )
  }

  function trimSavedResults(map) {
    const entries = Object.entries(map || {})
      .filter(([k, v]) => k && v && typeof v === 'object')
      .sort((a, b) => Number((b[1] && b[1].at) || 0) - Number((a[1] && a[1].at) || 0))
      .slice(0, MAX_SAVED_RESULTS)
    const out = {}
    for (const [k, v] of entries) out[k] = v
    return out
  }

  async function readSavedResults() {
    const raw = await api.storage.get(SAVED_RESULTS_KEY).catch(() => null)
    return raw && typeof raw === 'object' ? { ...raw } : {}
  }

  async function isAutoSaveEnabled() {
    const raw = await api.storage.get(SETTINGS_KEY).catch(() => null)
    return !!(raw && typeof raw === 'object' ? raw.autoSave !== false : true)
  }

  async function tick() {
    if (ticking) return
    ticking = true
    try {
      const autoSave = await isAutoSaveEnabled()
      if (!autoSave) return

      const tasks = await api.task.list(40).catch(() => [])
      if (!Array.isArray(tasks) || !tasks.length) return

      const saved = await readSavedResults()
      let changed = false

      for (const task of tasks) {
        const taskId = String(task && task.id ? task.id : '').trim()
        if (!taskId) continue
        if (saved[taskId] && saved[taskId].savedPath) continue

        const status = String(task && task.status ? task.status : '')
        if (status !== 'succeeded') continue

        const kind = String(task && task.kind ? task.kind : '')
        if (kind !== 'http.request') continue

        const dataUrl = parseTaskImageData(task)
        if (!dataUrl) continue

        const savedPath = await api.files.saveImageBase64(dataUrl).catch(() => '')
        if (!savedPath) continue

        saved[taskId] = {
          savedPath: String(savedPath),
          at: Date.now(),
          by: 'background',
        }
        changed = true
      }

      if (changed) {
        await api.storage.set(SAVED_RESULTS_KEY, trimSavedResults(saved)).catch(() => {})
      }
    } finally {
      ticking = false
    }
  }

  setInterval(() => {
    void tick()
  }, POLL_INTERVAL)
  void tick()
})()

