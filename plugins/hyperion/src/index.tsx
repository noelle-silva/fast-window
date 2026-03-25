import * as React from 'react'
import { createRoot } from 'react-dom/client'

type Api = {
  __meta?: { runtime?: 'ui' | 'background' }
  ui: { showToast: (message: string) => Promise<void> | void; back?: () => Promise<void> | void }
  files: {
    getOutputDir: () => Promise<string>
    pickOutputDir: () => Promise<string | null>
    openDir: (dir: string) => Promise<void>
    listDir: (req: { scope: 'output'; dir?: string | null }) => Promise<
      { name: string; isDirectory: boolean; isFile: boolean; size: number; modifiedMs: number }[]
    >
    readText: (req: { scope: 'output'; path: string }) => Promise<string>
    writeText: (req: { scope: 'output'; path: string; text: string; overwrite?: boolean | null }) => Promise<string>
    readBase64: (req: { scope: 'output'; path: string }) => Promise<string>
    writeBase64: (req: { scope: 'output'; path: string; dataUrlOrBase64: string; overwrite?: boolean | null }) => Promise<string>
    rename: (req: { scope: 'output'; from: string; to: string; overwrite?: boolean | null }) => Promise<void>
    delete: (req: { scope: 'output'; path: string }) => Promise<void>
    pickImages: (maxCount?: number | null) => Promise<{ name: string; dataUrl: string }[]>
  }
}

type NoteMeta = {
  id: string
  title: string
  file: string
  createdAtMs: number
  updatedAtMs: number
}

type HyperionIndexV1 = {
  version: 1
  notes: Record<string, NoteMeta>
}

const NOTES_DIR = 'Notes'
const ASSETS_DIR = 'Assets'
const INDEX_FILE = 'hyperion-index.json'

function getApi(): Api {
  return (window as any).fastWindow as Api
}

function nowId(): string {
  const d = new Date()
  const pad = (n: number, w: number) => String(n).padStart(w, '0')
  return (
    pad(d.getFullYear(), 4) +
    pad(d.getMonth() + 1, 2) +
    pad(d.getDate(), 2) +
    pad(d.getHours(), 2) +
    pad(d.getMinutes(), 2) +
    pad(d.getSeconds(), 2) +
    pad(d.getMilliseconds(), 3)
  )
}

function safeTitleForFile(title: string): string {
  const raw = String(title || '').trim().replace(/\s+/g, ' ')
  const base = raw || '未命名'
  let s = base.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
  s = s.replace(/[. ]+$/g, '').trim()
  if (!s) s = '未命名'
  if (s.length > 60) s = s.slice(0, 60).trim()
  return s || '未命名'
}

function noteFilename(id: string, title: string): string {
  return `${id}_${safeTitleForFile(title)}.html`
}

function parseNoteFilename(name: string): { id: string; title: string } | null {
  const lower = name.toLowerCase()
  if (!(lower.endsWith('.html') || lower.endsWith('.htm'))) return null
  const base = name.replace(/\.html?$/i, '')
  const idx = base.indexOf('_')
  if (idx <= 0) return null
  const id = base.slice(0, idx).trim()
  if (!/^\d{8,}$/.test(id)) return null
  const title = base.slice(idx + 1).trim()
  return { id, title: title || '未命名' }
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function buildNoteHtmlDoc(meta: { id: string; title: string; contentHtml: string }): string {
  const title = String(meta.title || '未命名').trim() || '未命名'
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="hyperion-note-id" content="${escapeHtml(meta.id)}" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height: 1.6; margin: 22px; }
      img { max-width: 100%; height: auto; }
      pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
      pre { padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 10px; overflow: auto; }
      blockquote { margin: 0; padding-left: 12px; border-left: 3px solid #e5e7eb; color: #374151; }
    </style>
  </head>
  <body>
    <div id="hyperion-content">${meta.contentHtml || ''}</div>
  </body>
</html>`
}

function normalizeEditorHtmlForSave(html: string): string {
  const doc = new DOMParser().parseFromString(`<div id="__root__">${html || ''}</div>`, 'text/html')
  const root = doc.getElementById('__root__')
  if (!root) return html || ''

  const imgs = Array.from(root.querySelectorAll('img'))
  for (const img of imgs) {
    const assetRel = (img.getAttribute('data-hyperion-asset') || '').trim()
    if (assetRel) {
      img.setAttribute('src', `../${assetRel.replace(/^[./]+/, '')}`)
    }
  }
  return root.innerHTML
}

async function sha256Hex(dataUrlOrBase64: string): Promise<string> {
  const s = String(dataUrlOrBase64 || '').trim()
  const b64 = s.startsWith('data:') ? (s.split(',', 2)[1] || '') : s
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const hash = await crypto.subtle.digest('SHA-256', bin)
  const out = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return out
}

function mimeFromDataUrl(dataUrl: string): string {
  const m = /^data:([^;]+);base64,/.exec(String(dataUrl || '').trim())
  return m ? String(m[1] || '').toLowerCase() : ''
}

function extFromMime(mime: string): string {
  const m = String(mime || '').toLowerCase()
  if (m === 'image/jpeg') return 'jpg'
  if (m === 'image/png') return 'png'
  if (m === 'image/webp') return 'webp'
  if (m === 'image/gif') return 'gif'
  if (m === 'image/svg+xml') return 'svg'
  return ''
}

function monthFolder(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

async function ensureVaultDirs(api: Api): Promise<void> {
  await api.files.listDir({ scope: 'output', dir: NOTES_DIR }).catch(() => {})
  await api.files.listDir({ scope: 'output', dir: ASSETS_DIR }).catch(() => {})
}

async function loadIndex(api: Api): Promise<HyperionIndexV1> {
  try {
    const raw = await api.files.readText({ scope: 'output', path: INDEX_FILE })
    const parsed = JSON.parse(raw || 'null')
    if (!parsed || typeof parsed !== 'object') throw new Error('bad index')
    if (parsed.version !== 1) throw new Error('bad index version')
    if (!parsed.notes || typeof parsed.notes !== 'object') throw new Error('bad notes')
    return parsed as HyperionIndexV1
  } catch {
    const idx: HyperionIndexV1 = { version: 1, notes: {} }
    await api.files.writeText({ scope: 'output', path: INDEX_FILE, text: JSON.stringify(idx, null, 2), overwrite: true }).catch(() => {})
    return idx
  }
}

async function saveIndex(api: Api, idx: HyperionIndexV1): Promise<void> {
  await api.files.writeText({ scope: 'output', path: INDEX_FILE, text: JSON.stringify(idx, null, 2), overwrite: true })
}

async function rebuildIndexFromFs(api: Api, idx: HyperionIndexV1): Promise<HyperionIndexV1> {
  await ensureVaultDirs(api)
  const items = await api.files.listDir({ scope: 'output', dir: NOTES_DIR })
  const nextNotes: Record<string, NoteMeta> = {}

  for (const ent of items) {
    if (!ent.isFile) continue
    const parsed = parseNoteFilename(ent.name)
    if (!parsed) continue

    const file = `${NOTES_DIR}/${ent.name}`
    const existing = idx.notes[parsed.id]
    const createdAtMs = existing?.createdAtMs ?? ent.modifiedMs ?? Date.now()
    const updatedAtMs = ent.modifiedMs ?? existing?.updatedAtMs ?? createdAtMs
    nextNotes[parsed.id] = {
      id: parsed.id,
      title: parsed.title,
      file,
      createdAtMs,
      updatedAtMs,
    }
  }

  const next: HyperionIndexV1 = { ...idx, notes: nextNotes }
  await saveIndex(api, next).catch(() => {})
  return next
}

async function readNoteDoc(api: Api, file: string): Promise<{ title: string; contentHtml: string }> {
  const raw = await api.files.readText({ scope: 'output', path: file })
  const doc = new DOMParser().parseFromString(raw, 'text/html')
  const title = String(doc.querySelector('title')?.textContent || '').trim() || '未命名'
  const root = doc.getElementById('hyperion-content')
  const content = root ? root.innerHTML : (doc.body?.innerHTML || '')

  const wrap = new DOMParser().parseFromString(`<div id="__root__">${content}</div>`, 'text/html')
  const r = wrap.getElementById('__root__')
  if (!r) return { title, contentHtml: content }

  const imgs = Array.from(r.querySelectorAll('img'))
  for (const img of imgs) {
    const src = (img.getAttribute('src') || '').trim()
    if (!src) continue
    const rel =
      src.startsWith('../') ? src.slice(3)
      : src.startsWith('./') ? src.slice(2)
      : src
    if (!rel.startsWith(`${ASSETS_DIR}/`)) continue

    img.setAttribute('data-hyperion-asset', rel)
    img.setAttribute('data-hyperion-src', src)
    try {
      const dataUrl = await api.files.readBase64({ scope: 'output', path: rel })
      if (String(dataUrl || '').startsWith('data:')) {
        img.setAttribute('src', dataUrl)
      }
    } catch {}
  }

  return { title, contentHtml: r.innerHTML }
}

function App() {
  const api = React.useMemo(() => getApi(), [])

  const [vaultDir, setVaultDir] = React.useState<string>('')
  const [loading, setLoading] = React.useState(true)

  const [idx, setIdx] = React.useState<HyperionIndexV1>({ version: 1, notes: {} })
  const [activeId, setActiveId] = React.useState<string>('')
  const [title, setTitle] = React.useState<string>('未命名')
  const editorRef = React.useRef<HTMLDivElement | null>(null)
  const [search, setSearch] = React.useState('')
  const deleteConfirmAtRef = React.useRef(0)

  const notes = React.useMemo(() => {
    const q = String(search || '').trim().toLowerCase()
    const list = Object.values(idx.notes)
    const filtered = q ? list.filter(n => String(n.title || '').toLowerCase().includes(q) || n.id.includes(q)) : list
    return filtered.sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0))
  }, [idx.notes, search])

  const active = activeId ? idx.notes[activeId] : null

  const setEditorHtml = (html: string) => {
    const el = editorRef.current
    if (!el) return
    el.innerHTML = html || ''
  }

  const getEditorHtml = () => {
    const el = editorRef.current
    return el ? el.innerHTML : ''
  }

  const refreshAll = React.useCallback(async () => {
    setLoading(true)
    try {
      const dir = await api.files.getOutputDir().catch(() => '')
      setVaultDir(dir)
      await ensureVaultDirs(api)
      const base = await loadIndex(api)
      const next = await rebuildIndexFromFs(api, base)
      setIdx(next)
      if (!activeId && Object.keys(next.notes).length) {
        const first = Object.values(next.notes).sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0))[0]
        if (first) setActiveId(first.id)
      }
    } finally {
      setLoading(false)
    }
  }, [activeId, api])

  React.useEffect(() => {
    void refreshAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    const run = async () => {
      if (!active) return
      setLoading(true)
      try {
        const { title: t, contentHtml } = await readNoteDoc(api, active.file)
        setTitle(t)
        setEditorHtml(contentHtml)
      } catch (e: any) {
        api.ui.showToast(String(e?.message || e || '读取失败'))
      } finally {
        setLoading(false)
      }
    }
    void run()
  }, [active?.file]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickVault = React.useCallback(async () => {
    const picked = await api.files.pickOutputDir().catch(() => null)
    if (!picked) return
    setVaultDir(picked)
    await api.ui.showToast('已设置 Hyperion 库位置')
    await refreshAll()
  }, [api, refreshAll])

  const backToHome = React.useCallback(async () => {
    try {
      await api.ui.back?.()
    } catch {
      // ignore
    }
  }, [api])

  const openVault = React.useCallback(async () => {
    const dir = vaultDir || (await api.files.getOutputDir().catch(() => ''))
    if (!dir) return api.ui.showToast('库目录不可用')
    await api.files.openDir(dir).catch(e => api.ui.showToast(String((e as any)?.message || e || '打开失败')))
  }, [api, vaultDir])

  const createNote = React.useCallback(async () => {
    setLoading(true)
    try {
      const id = nowId()
      const t = '未命名'
      const filename = noteFilename(id, t)
      const file = `${NOTES_DIR}/${filename}`

      const contentHtml = `<h1>${escapeHtml(t)}</h1><p></p>`
      const htmlDoc = buildNoteHtmlDoc({ id, title: t, contentHtml })
      await api.files.writeText({ scope: 'output', path: file, text: htmlDoc, overwrite: false })

      const meta: NoteMeta = { id, title: t, file, createdAtMs: Date.now(), updatedAtMs: Date.now() }
      const next: HyperionIndexV1 = { ...idx, notes: { ...idx.notes, [id]: meta } }
      setIdx(next)
      await saveIndex(api, next).catch(() => {})
      setActiveId(id)
      setTitle(t)
      setEditorHtml(contentHtml)
    } catch (e: any) {
      api.ui.showToast(String(e?.message || e || '创建失败'))
    } finally {
      setLoading(false)
    }
  }, [api, idx])

  const saveNote = React.useCallback(async () => {
    if (!active) return
    setLoading(true)
    try {
      const id = active.id
      const nextTitle = String(title || '').trim() || '未命名'
      const nextFilename = noteFilename(id, nextTitle)
      const nextFile = `${NOTES_DIR}/${nextFilename}`

      if (active.file !== nextFile) {
        await api.files.rename({ scope: 'output', from: active.file, to: nextFile, overwrite: false })
      }

      const contentHtml = normalizeEditorHtmlForSave(getEditorHtml())
      const htmlDoc = buildNoteHtmlDoc({ id, title: nextTitle, contentHtml })
      await api.files.writeText({ scope: 'output', path: nextFile, text: htmlDoc, overwrite: true })

      const updatedAtMs = Date.now()
      const meta: NoteMeta = { ...active, title: nextTitle, file: nextFile, updatedAtMs }
      const nextIdx: HyperionIndexV1 = { ...idx, notes: { ...idx.notes, [id]: meta } }
      setIdx(nextIdx)
      await saveIndex(api, nextIdx).catch(() => {})
      api.ui.showToast('已保存')
    } catch (e: any) {
      api.ui.showToast(String(e?.message || e || '保存失败'))
    } finally {
      setLoading(false)
    }
  }, [active, api, idx, title])

  const deleteNote = React.useCallback(async () => {
    if (!active) return
    const now = Date.now()
    if (now - deleteConfirmAtRef.current > 2000) {
      deleteConfirmAtRef.current = now
      return api.ui.showToast('再点一次删除（2 秒内）')
    }

    setLoading(true)
    try {
      await api.files.delete({ scope: 'output', path: active.file })
      const nextNotes = { ...idx.notes }
      delete nextNotes[active.id]
      const nextIdx: HyperionIndexV1 = { ...idx, notes: nextNotes }
      setIdx(nextIdx)
      await saveIndex(api, nextIdx).catch(() => {})

      const rest = Object.values(nextIdx.notes).sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0))
      const nextActive = rest[0]
      setActiveId(nextActive ? nextActive.id : '')
      setTitle(nextActive ? nextActive.title : '未命名')
      setEditorHtml('')
      api.ui.showToast('已删除')
    } catch (e: any) {
      api.ui.showToast(String(e?.message || e || '删除失败'))
    } finally {
      setLoading(false)
    }
  }, [active, api, idx])

  const insertImage = React.useCallback(async () => {
    if (!active) return
    try {
      const picked = await api.files.pickImages(1)
      const item = picked && picked[0]
      if (!item || !item.dataUrl) return

      const mime = mimeFromDataUrl(item.dataUrl)
      const ext = extFromMime(mime) || 'png'
      const hash = await sha256Hex(item.dataUrl)
      const month = monthFolder()
      const assetRel = `${ASSETS_DIR}/${month}/${hash}.${ext}`

      await api.files.writeBase64({ scope: 'output', path: assetRel, dataUrlOrBase64: item.dataUrl, overwrite: false }).catch(() => {})

      const html = getEditorHtml()
      const imgHtml = `<p><img src="${item.dataUrl}" data-hyperion-asset="${escapeHtml(assetRel)}" alt="" /></p>`
      setEditorHtml((html || '') + imgHtml)
      api.ui.showToast('已插入图片')
    } catch (e: any) {
      api.ui.showToast(String(e?.message || e || '插入失败'))
    }
  }, [active, api])

  const styles = `
  :root {
    --bg: #0b1020;
    --panel: rgba(255,255,255,0.06);
    --panel2: rgba(255,255,255,0.10);
    --text: rgba(255,255,255,0.92);
    --muted: rgba(255,255,255,0.62);
    --line: rgba(255,255,255,0.10);
    --primary: #f59e0b;
    --danger: #ef4444;
    --shadow: 0 10px 30px rgba(0,0,0,0.30);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { background: radial-gradient(1200px 700px at 30% 10%, rgba(245,158,11,0.18), transparent 55%), var(--bg); color: var(--text); }
  .wrap { height: 100vh; display: flex; flex-direction: column; }
  .topbar {
    height: 46px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    border-bottom: 1px solid var(--line);
    background: rgba(0,0,0,0.28);
    backdrop-filter: blur(10px);
  }
  .brand { font-weight: 900; letter-spacing: 0.6px; }
  .path { flex: 1; font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .btn {
    height: 30px;
    padding: 0 10px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: rgba(255,255,255,0.06);
    color: var(--text);
    cursor: pointer;
    user-select: none;
    font-size: 12px;
  }
  .btn:hover { background: rgba(255,255,255,0.10); }
  .btn:focus-visible { outline: 2px solid rgba(245,158,11,0.75); outline-offset: 2px; }
  .btn.primary { border-color: transparent; background: rgba(245,158,11,0.16); }
  .btn.primary:hover { background: rgba(245,158,11,0.24); }
  .btn.danger { border-color: transparent; background: rgba(239,68,68,0.16); }
  .btn.danger:hover { background: rgba(239,68,68,0.24); }

  .main { flex: 1; display: grid; grid-template-columns: 320px 1fr; gap: 12px; padding: 12px; min-height: 0; }
  @media (max-width: 920px) { .main { grid-template-columns: 1fr; } }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); overflow: hidden; min-width: 0; display: flex; flex-direction: column; }
  .panelHead { padding: 10px; border-bottom: 1px solid var(--line); display: flex; gap: 8px; align-items: center; }
  .input {
    width: 100%;
    height: 34px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: rgba(0,0,0,0.20);
    color: var(--text);
    padding: 0 10px;
    outline: none;
  }
  .list { flex: 1; overflow: auto; padding: 6px; }
  .item {
    padding: 10px 10px;
    border-radius: 12px;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .item:hover { background: rgba(255,255,255,0.06); }
  .item.active { background: rgba(245,158,11,0.10); border-color: rgba(245,158,11,0.25); }
  .itemTitle { font-weight: 800; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .itemMeta { font-size: 12px; color: var(--muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .editorWrap { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .toolbar { padding: 10px; border-bottom: 1px solid var(--line); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .titleRow { flex: 1; min-width: 220px; display: flex; gap: 8px; align-items: center; }
  .editor {
    flex: 1;
    overflow: auto;
    padding: 14px 14px;
    outline: none;
  }
  .editor[contenteditable="true"]:empty:before { content: "在这里写…（保存后会落盘为 HTML）"; color: var(--muted); }
  .hint { font-size: 12px; color: var(--muted); padding: 0 10px 10px; }
  `

  return (
    <div className="wrap">
      <style>{styles}</style>
      <div className="topbar">
        <button className="btn" onClick={backToHome} title="返回主界面" aria-label="返回主界面">← 主界面</button>
        <div className="brand">Hyperion</div>
        <div className="path" title={vaultDir}>{vaultDir || (loading ? '加载中…' : '未设置库目录')}</div>
        <button className="btn" onClick={openVault}>打开库</button>
        <button className="btn" onClick={pickVault}>选择库</button>
      </div>

      <div className="main">
        <div className="panel">
          <div className="panelHead">
            <input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索（标题 / ID）" />
            <button className="btn primary" onClick={createNote}>新建</button>
          </div>
          <div className="list">
            {notes.map(n => (
              <div
                key={n.id}
                className={'item' + (n.id === activeId ? ' active' : '')}
                onClick={() => setActiveId(n.id)}
                title={n.file}
              >
                <div className="itemTitle">{n.title || '未命名'}</div>
                <div className="itemMeta">{n.id}</div>
              </div>
            ))}
            {notes.length === 0 && <div className="hint">这里没有“文件夹树”。只有星辰般的笔记列表。</div>}
          </div>
        </div>

        <div className="panel">
          <div className="editorWrap">
            <div className="toolbar">
              <div className="titleRow">
                <input
                  className="input"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="标题（会体现在文件名：ID_标题.html）"
                />
              </div>
              <button className="btn" onClick={insertImage} disabled={!active}>插入图片</button>
              <button className="btn primary" onClick={saveNote} disabled={!active}>保存</button>
              <button className="btn danger" onClick={deleteNote} disabled={!active}>删除</button>
            </div>

            <div
              ref={editorRef}
              className="editor"
              contentEditable={!loading && !!active}
              suppressContentEditableWarning
            />
            <div className="hint">
              {active ? `落盘：${active.file}` : '先新建一条笔记。'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

;(function bootstrap() {
  const api = getApi()
  const runtime = String(api?.__meta?.runtime || 'ui')
  if (runtime === 'background') return

  const el = document.getElementById('app')
  if (!el) return
  createRoot(el).render(<App />)
})()

