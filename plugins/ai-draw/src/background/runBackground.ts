import type { AiDrawGateway } from '../gateway/types'
import { normalizeImageDataUrlOrBase64, toImageDataUrlFromBase64 } from '../core/images'

export function runAiDrawBackground(gateway: AiDrawGateway) {
  const { settingsStore, backgroundSaveQueue, outputImages, generationTasks } = gateway
  const POLL_INTERVAL = 1200
  const MAX_SAVED_RESULTS = 200
  const MAX_SAVE_ITEMS = 50
  const MAX_SAVE_PER_TICK = 3
  let ticking = false

  function stripCodeFences(s: any) {
    const raw = String(s || '').trim()
    if (!raw) return ''
    if (raw.startsWith('```')) {
      const i = raw.indexOf('\n')
      const j = raw.lastIndexOf('```')
      if (i >= 0 && j > i) return raw.slice(i + 1, j).trim()
    }
    return raw
  }

  function extractImageFromText(text: any) {
    const s = String(text || '').trim()
    if (!s) return ''

    const dataUrlMatch = s.match(/data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\r\n]+/i)
    if (dataUrlMatch && dataUrlMatch[0]) return normalizeImageDataUrlOrBase64(dataUrlMatch[0])

    const maybeJson = stripCodeFences(s)
    try {
      const j = JSON.parse(maybeJson)
      const dataUrl = j?.data_url || j?.dataUrl || j?.image || j?.image_data_url
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) return normalizeImageDataUrlOrBase64(dataUrl)
      const b64 = j?.b64_png || j?.b64_json || j?.b64 || j?.base64 || j?.image_base64 || j?.png_base64
      if (typeof b64 === 'string' && b64.trim()) return toImageDataUrlFromBase64(b64)
    } catch {}

    if (/^[A-Za-z0-9+/=\r\n]+$/.test(s) && s.length > 200) {
      return toImageDataUrlFromBase64(s)
    }

    return ''
  }

  function parseTaskImageData(task: any) {
    const result = task && task.result && typeof task.result === 'object' ? task.result : {}
    const httpStatus = Number(result.status)
    if (!Number.isFinite(httpStatus) || httpStatus < 200 || httpStatus >= 300) return ''

    const bodyText = typeof result.body === 'string' ? result.body : ''
    let parsed: any = null
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
    const content = (Array.isArray(parsed?.choices) && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content) || ''

    return (direct && normalizeImageDataUrlOrBase64(direct)) || (b64 && toImageDataUrlFromBase64(b64)) || extractImageFromText(content)
  }

  function trimSavedResults(map: any) {
    const entries = Object.entries(map || {})
      .filter(([k, v]) => k && v && typeof v === 'object')
      .sort((a, b) => Number((b[1] && (b[1] as any).at) || 0) - Number((a[1] && (a[1] as any).at) || 0))
      .slice(0, MAX_SAVED_RESULTS)
    const out: any = {}
    for (const [k, v] of entries) out[k] = v
    return out
  }

  function trimSaveMap(map: any) {
    const entries = Object.entries(map || {})
      .filter(([k, v]) => k && v && typeof v === 'object')
      .sort((a, b) => Number((b[1] && (b[1] as any).at) || 0) - Number((a[1] && (a[1] as any).at) || 0))
      .slice(0, MAX_SAVE_ITEMS)
    const out: any = {}
    for (const [k, v] of entries) out[k] = v
    return out
  }

  async function readSavedResults() {
    const raw = await backgroundSaveQueue.readSavedResults().catch(() => null)
    return raw && typeof raw === 'object' ? { ...raw } : {}
  }

  async function readSaveRequests() {
    const raw = await backgroundSaveQueue.readRequests().catch(() => null)
    return raw && typeof raw === 'object' ? { ...raw } : {}
  }

  async function readSaveResponses() {
    const raw = await backgroundSaveQueue.readResponses().catch(() => null)
    return raw && typeof raw === 'object' ? { ...raw } : {}
  }

  async function isAutoSaveEnabled() {
    const raw = await settingsStore.read().catch(() => null)
    return !!(raw && typeof raw === 'object' ? (raw as any).autoSave !== false : true)
  }

  async function tick() {
    if (ticking) return
    ticking = true
    try {
      const autoSave = await isAutoSaveEnabled()
      const reqMap = await readSaveRequests()
      const resMap = await readSaveResponses()
      const reqEntries = Object.entries(reqMap)
        .filter(([k, v]) => k && v && typeof v === 'object' && typeof (v as any).dataUrl === 'string' && String((v as any).dataUrl).trim())
        .sort((a, b) => Number(((a[1] as any) && (a[1] as any).at) || 0) - Number(((b[1] as any) && (b[1] as any).at) || 0))

      let saveChanged = false
      let processed = 0
      for (const [rid, req] of reqEntries) {
        if (processed >= MAX_SAVE_PER_TICK) break

        if (resMap[rid] && (resMap[rid] as any).savedPath) {
          delete (reqMap as any)[rid]
          saveChanged = true
          continue
        }

        const dataUrl = String(req && (req as any).dataUrl ? (req as any).dataUrl : '').trim()
        if (!dataUrl) {
          delete (reqMap as any)[rid]
          saveChanged = true
          continue
        }

        const savedPath = await outputImages.saveBase64(dataUrl).catch(() => '')
        if (!savedPath) continue

        ;(resMap as any)[rid] = { savedPath: String(savedPath), at: Date.now(), by: 'background' }
        delete (reqMap as any)[rid]
        saveChanged = true
        processed++
      }

      if (saveChanged) {
        await backgroundSaveQueue.writeRequests(trimSaveMap(reqMap)).catch(() => {})
        await backgroundSaveQueue.writeResponses(trimSaveMap(resMap)).catch(() => {})
      }

      if (!autoSave) return

      const tasks = await generationTasks.list(40).catch(() => [])
      if (!Array.isArray(tasks) || !tasks.length) return

      const saved = await readSavedResults()
      let changed = false

      for (const task of tasks) {
        const taskId = String(task && (task as any).id ? (task as any).id : '').trim()
        if (!taskId) continue
        if ((saved as any)[taskId] && (saved as any)[taskId].savedPath) continue

        const status = String(task && (task as any).status ? (task as any).status : '')
        if (status !== 'succeeded') continue

        const kind = String(task && (task as any).kind ? (task as any).kind : '')
        if (kind !== 'http.request') continue

        const tagsRaw = task && (task as any).meta && Array.isArray((task as any).meta.tags) ? (task as any).meta.tags : []
        const tags = Array.isArray(tagsRaw) ? tagsRaw.map((x) => String(x || '').trim()).filter(Boolean) : []
        if (tags.includes('no-autosave')) continue

        const dataUrl = parseTaskImageData(task)
        if (!dataUrl) continue

        const savedPath = await outputImages.saveBase64(dataUrl).catch(() => '')
        if (!savedPath) continue

        ;(saved as any)[taskId] = { savedPath: String(savedPath), at: Date.now(), by: 'background' }
        changed = true
      }

      if (changed) {
        await backgroundSaveQueue.writeSavedResults(trimSavedResults(saved)).catch(() => {})
      }
    } finally {
      ticking = false
    }
  }

  setInterval(() => void tick(), POLL_INTERVAL)
  void tick()
}

