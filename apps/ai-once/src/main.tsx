import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createDirectClient } from './backendClient'
import { OldPluginIcon } from './components/Icon'
import type { AppData, DataDirStatus, DirectClient, DraftImage, FwLaunchInfo, HistoryDoc, HistoryEntry, Provider, Space, Template } from './types'
import './styles.css'

const appWindow = getCurrentWindow()
const DEFAULT_LAUNCH_INFO: FwLaunchInfo = { launched: false, standalone: true, mode: 'standalone' }

function errorMessage(error: unknown, fallback: string): string { return String((error as { message?: string })?.message || error || fallback) }
function id(prefix: string): string { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}` }
function now(): number { return Date.now() }
function fmtBytes(value: number): string { if (!Number.isFinite(value) || value <= 0) return '0 B'; const units = ['B', 'KB', 'MB']; let size = value; let i = 0; while (size >= 1024 && i < units.length - 1) { size /= 1024; i += 1 } return `${i > 0 && size < 10 ? size.toFixed(1) : Math.round(size)} ${units[i]}` }
function shortDate(value: string): string { const d = new Date(value); return Number.isNaN(d.getTime()) ? value : d.toLocaleString() }
function isInteractiveTarget(target: EventTarget | null): boolean { return target instanceof HTMLElement && Boolean(target.closest('button,input,select,textarea,a,[role="button"],[data-window-control]')) }
function activeProvider(data: AppData | null): Provider | null { return data?.settings.providers.find(p => p.id === data.settings.activeProviderId) || data?.settings.providers[0] || null }
function activeTemplate(space: Space | null): Template | null { return space?.templates.find(t => t.id === space.activeTemplateId) || space?.templates[0] || null }
function defaultModel(space: Space | null, providerId: string): string { return space?.defaultModelByProvider?.[providerId] || '' }

async function fileToDraftImage(file: File): Promise<DraftImage> {
  const dataUrl = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onerror = () => reject(new Error('读取图片失败')); r.onload = () => resolve(String(r.result || '')); r.readAsDataURL(file) })
  return { id: id('img'), name: file.name || 'image', type: file.type, size: file.size, dataUrl, previewUrl: URL.createObjectURL(file) }
}

function App() {
  const [launchInfo, setLaunchInfo] = React.useState<FwLaunchInfo>(DEFAULT_LAUNCH_INFO)
  const [initialCommand, setInitialCommand] = React.useState<string | null>(null)
  const [runtimeCommand, setRuntimeCommand] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<DataDirStatus | null>(null)
  const [client, setClient] = React.useState<DirectClient | null>(null)
  const [data, setData] = React.useState<AppData | null>(null)
  const [history, setHistory] = React.useState<HistoryEntry[]>([])
  const [health, setHealth] = React.useState<Record<string, unknown> | null>(null)
  const [phase, setPhase] = React.useState<'starting' | 'ready' | 'failed'>('starting')
  const [view, setView] = React.useState<'spaces' | 'workbench'>('spaces')
  const [spaceId, setSpaceId] = React.useState('')
  const [modal, setModal] = React.useState<'' | 'settings' | 'templates' | 'space'>('')
  const [prompt, setPrompt] = React.useState('')
  const [answer, setAnswer] = React.useState('')
  const [images, setImages] = React.useState<DraftImage[]>([])
  const [modelDraft, setModelDraft] = React.useState('')
  const [customModel, setCustomModel] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<AppData | null>(null)
  const [spaceName, setSpaceName] = React.useState('')
  const readyRef = React.useRef(false)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const imagesRef = React.useRef<DraftImage[]>([])

  const currentSpace = data?.spaces.find(s => s.id === spaceId) || data?.spaces[0] || null
  const provider = activeProvider(data)
  const template = activeTemplate(currentSpace)
  const providerId = provider?.id || ''
  const model = modelDraft === '__custom__' ? customModel.trim() : (modelDraft || defaultModel(currentSpace, providerId)).trim()
  const imageBytes = images.reduce((sum, item) => sum + item.size, 0)

  const refreshStatus = React.useCallback(async () => { const next = await invoke<DataDirStatus>('data_dir_status').catch(() => null); setStatus(next); return next }, [])
  const loadFromClient = React.useCallback(async (nextClient: DirectClient) => {
    const [nextData, nextHistory, nextHealth] = await Promise.all([nextClient.request<AppData>('aiOnce.data.get'), nextClient.request<HistoryDoc>('aiOnce.history.list'), nextClient.request<Record<string, unknown>>('aiOnce.health')])
    setData(nextData); setHistory(nextHistory.items || []); setHealth(nextHealth)
    const firstSpace = nextData.spaces[0]
    setSpaceId(current => current && nextData.spaces.some(s => s.id === current) ? current : firstSpace?.id || '')
  }, [])
  const connect = React.useCallback(async (options?: { restartBackend?: boolean }) => {
    setBusy(true); setError(null); setPhase('starting'); client?.close(); setClient(null)
    try { if (options?.restartBackend) await invoke('restart_backend'); const nextClient = await createDirectClient(); await loadFromClient(nextClient); setClient(nextClient); setPhase('ready'); await refreshStatus() }
    catch (e) { setPhase('failed'); setError(errorMessage(e, '启动 AI Once 后台失败')); await refreshStatus() }
    finally { setBusy(false) }
  }, [client, loadFromClient, refreshStatus])

  const saveData = React.useCallback(async (next: AppData) => { if (!client) return; const saved = await client.request<AppData>('aiOnce.data.save', next); setData(saved) }, [client])
  const updateData = React.useCallback(async (recipe: (draft: AppData) => void) => { if (!data) return; const next = structuredClone(data) as AppData; recipe(next); await saveData(next) }, [data, saveData])

  React.useEffect(() => { if (!readyRef.current) { readyRef.current = true; void invoke('app_ready').catch(() => {}) } }, [])
  React.useEffect(() => { let cancelled = false; void (async () => { const [li, cmd] = await Promise.all([invoke<FwLaunchInfo>('fw_launch_info').catch(() => DEFAULT_LAUNCH_INFO), invoke<string | null>('fw_initial_command').catch(() => null)]); if (cancelled) return; setLaunchInfo(li); setInitialCommand(cmd); if (cmd === 'open-settings') setModal('settings'); if (cmd === 'ask-once' || cmd === 'new-prompt') setView('workbench'); await refreshStatus(); if (!cancelled) await connect() })(); return () => { cancelled = true } }, [])
  React.useEffect(() => { let unlisten: (() => void) | null = null; let cancelled = false; void listen<{ command?: string }>('fw-app-command', event => { const command = String(event.payload?.command || '').trim(); if (!command) return; setRuntimeCommand(command); if (command === 'open-settings') setModal('settings'); if (command === 'ask-once' || command === 'new-prompt') { setView('workbench'); setPrompt(''); setAnswer(''); clearImages() } }).then(u => { if (cancelled) u(); else unlisten = u }).catch(() => {}); return () => { cancelled = true; unlisten?.() } }, [])
  React.useEffect(() => () => client?.close(), [client])
  React.useEffect(() => () => { imagesRef.current.forEach(item => URL.revokeObjectURL(item.previewUrl)) }, [])

  function clearImages() { setImages(current => { current.forEach(item => URL.revokeObjectURL(item.previewUrl)); imagesRef.current = []; return [] }) }
  async function addImageFiles(files: FileList | File[]) {
    const limits = data?.settings || { imageMaxCount: 6, imageMaxMb: 8 }
    const maxBytes = limits.imageMaxMb * 1024 * 1024
    const current = imagesRef.current
    const picked = Array.from(files).filter(file => file.type.startsWith('image/') && file.size <= maxBytes).slice(0, Math.max(0, limits.imageMaxCount - current.length))
    const next = [...current, ...(await Promise.all(picked.map(fileToDraftImage)))]
    imagesRef.current = next; setImages(next)
  }
  function removeImage(imageId: string) { setImages(current => { const hit = current.find(i => i.id === imageId); if (hit) URL.revokeObjectURL(hit.previewUrl); const next = current.filter(i => i.id !== imageId); imagesRef.current = next; return next }) }

  async function askOnce() {
    if (!client || !currentSpace || !provider || busy) return
    setBusy(true); setError(null); setAnswer('')
    try {
      const entry = await client.request<HistoryEntry>('aiOnce.ask', { spaceId: currentSpace.id, templateId: template?.id || '', providerId: provider.id, model, input: prompt, images: images.map(({ previewUrl, id: _, ...rest }) => rest) })
      setAnswer(entry.output); const doc = await client.request<HistoryDoc>('aiOnce.history.list'); setHistory(doc.items || []); await loadFromClient(client)
    } catch (e) { setError(errorMessage(e, 'AI 请求失败')); const doc = await client.request<HistoryDoc>('aiOnce.history.list').catch(() => null); if (doc) setHistory(doc.items || []) }
    finally { setBusy(false) }
  }

  async function refreshModels() { if (!client || !provider) return; setBusy(true); setError(null); try { const next = await client.request<AppData>('aiOnce.models.refresh', { providerId: provider.id }); setData(next) } catch (e) { setError(errorMessage(e, '刷新模型失败')) } finally { setBusy(false) } }
  async function clearHistory() { if (!client) return; const doc = await client.request<HistoryDoc>('aiOnce.history.clear'); setHistory(doc.items || []) }
  async function pickDataDir() { setBusy(true); setError(null); try { const next = await invoke<DataDirStatus | null>('pick_data_dir'); if (next) setStatus(next); await connect() } catch (e) { setPhase('failed'); setError(errorMessage(e, '切换数据目录失败')); await refreshStatus() } finally { setBusy(false) } }

  function openSpace(id2: string) { setSpaceId(id2); setView('workbench'); setPrompt(''); setAnswer(''); setError(null); clearImages(); const s = data?.spaces.find(x => x.id === id2) || null; const m = defaultModel(s, providerId); setModelDraft(m); setCustomModel('') }
  function openSettings() { setEditing(data ? structuredClone(data) : null); setModal('settings') }
  function openTemplates() { setEditing(data ? structuredClone(data) : null); setModal('templates') }

  const onTopbarPointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>) => { if (event.button !== 0 || isInteractiveTarget(event.target)) return; void appWindow.startDragging() }, [])
  const providerLine = provider?.baseUrl || status?.dataDir || '等待后台连接'
  const models = provider?.modelsCache.items || []
  const canAsk = Boolean(client && !busy && (prompt.trim() || images.length) && model)

  return (
    <main className="app-shell">
      <header className="topbar" onPointerDown={onTopbarPointerDown}>
        <div className="brand-mark" aria-hidden="true"><OldPluginIcon /></div>
        <div className="title-block"><h1>AI 一次性响应</h1><p className="meta mono" title={providerLine}>{providerLine}</p></div>
        <button type="button" className="icon-btn" onClick={() => setView('spaces')} aria-label="返回空间列表">←</button>
        <button type="button" className={view === 'spaces' ? 'btn pri active' : 'btn'} onClick={() => setView('spaces')}>空间</button>
        <button type="button" className={view === 'workbench' ? 'btn pri active' : 'btn'} onClick={() => setView('workbench')}>工作台</button>
        <button type="button" className="btn" onClick={openSettings}>设置</button>
        <button type="button" className="btn" onClick={pickDataDir} disabled={busy}>数据目录</button>
        <button type="button" className="btn" onClick={() => void connect({ restartBackend: true })} disabled={busy}>重试</button>
        <div className={`status-badge ${phase}`}>{phase === 'ready' ? '就绪' : phase === 'failed' ? '需设置' : '启动中'}</div>
        <div className="mode-pill">{launchInfo.standalone ? 'standalone' : `FW ${launchInfo.mode}`}</div>
        {launchInfo.standalone ? <div className="window-controls" data-window-control><button type="button" onClick={() => appWindow.minimize()} aria-label="最小化">-</button><button type="button" onClick={() => appWindow.toggleMaximize()} aria-label="最大化或还原">□</button><button type="button" onClick={() => invoke('hide_to_tray')} aria-label="隐藏到托盘">×</button></div> : null}
      </header>

      {view === 'spaces' ? <SpacesView data={data} providerId={providerId} history={history} onOpen={openSpace} onAdd={() => { setSpaceName(''); setModal('space') }} onRename={(id2, name) => updateData(d => { const s = d.spaces.find(x => x.id === id2); if (s) { s.name = name; s.updatedAt = now() } })} onDelete={id2 => updateData(d => { d.spaces = d.spaces.filter(s => s.id !== id2); if (!d.spaces.length) { const tid = id('tpl'); d.spaces.push({ id: id('space'), name: '默认空间', createdAt: now(), updatedAt: now(), defaultModelByProvider: {}, activeTemplateId: tid, templates: [{ id: tid, name: '默认', systemPrompt: '' }] }) } })} onMove={(id2, dir) => updateData(d => { const i = d.spaces.findIndex(s => s.id === id2); const j = i + dir; if (i >= 0 && j >= 0 && j < d.spaces.length) [d.spaces[i], d.spaces[j]] = [d.spaces[j], d.spaces[i]] })} /> : null}

      {view === 'workbench' ? (
        <section className="content workbench-content">
          <aside className="rail card">
            <div className="panel-head"><h2>{currentSpace?.name || '空间'}</h2><span className="meta">{history.length} 条历史</span></div>
            <div className="kv-list"><span>供应商</span><strong>{provider?.name || '未配置'}</strong><span>模型</span><strong className="mono">{model || '未设置'}</strong><span>模板</span><strong>{template?.name || '默认'}</strong><span>数据目录</span><strong>{status?.writable ? '可写' : '未知/不可写'}</strong><span>初始命令</span><strong>{initialCommand || '无'}</strong><span>运行命令</span><strong>{runtimeCommand || '无'}</strong></div>
            <div className="hr" /><button type="button" className="btn full" onClick={openTemplates}>模板管理</button><button type="button" className="btn full" onClick={openSettings}>连接设置</button><button type="button" className="btn full" onClick={refreshModels} disabled={busy}>刷新模型</button>
            <div className="hr" /><div className="panel-head compact"><h3>最近历史</h3>{history.length ? <button type="button" className="link-btn" onClick={clearHistory} disabled={busy}>清空</button> : null}</div>
            <div className="history-list">{history.slice(0, 12).map(item => <button type="button" className="history-item" key={item.id} onClick={() => { setSpaceId(item.spaceId); setPrompt(item.input); setAnswer(item.output); setModelDraft(item.model); setView('workbench'); clearImages() }}><strong>{item.input || `${item.images.length} 张图片`}</strong><span>{item.error ? `失败：${item.error}` : `${item.model} · ${shortDate(item.createdAt)}`}</span></button>)}{!history.length ? <p className="muted">还没有历史记录</p> : null}</div>
          </aside>
          <section className="workbench card">
            <div className="space-topline"><select className="field sm" value={providerId} onChange={e => updateData(d => { d.settings.activeProviderId = e.target.value })}>{data?.settings.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><select className="field sm" value={currentSpace?.activeTemplateId || ''} onChange={e => updateData(d => { const s = d.spaces.find(x => x.id === currentSpace?.id); if (s) s.activeTemplateId = e.target.value })}>{currentSpace?.templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select><button type="button" className="btn" onClick={openTemplates}>模板管理</button><button type="button" className="btn" onClick={openSettings}>供应商设置</button></div>
            <div className="split"><section className="pane input-pane"><div className="row dense"><span className="pane-title">模型</span><select className="field sm grow-inline" value={modelDraft || defaultModel(currentSpace, providerId)} onChange={e => setModelDraft(e.target.value)}><option value="">选择模型</option>{models.map(m => <option key={m} value={m}>{m}</option>)}<option value="__custom__">自定义模型...</option></select>{modelDraft === '__custom__' ? <input className="field mono grow-inline" value={customModel} onChange={e => setCustomModel(e.target.value)} placeholder="自定义模型名" /> : null}<button type="button" className="btn" onClick={() => fileInputRef.current?.click()} disabled={busy}>图片</button><button type="button" className="btn ok" onClick={askOnce} disabled={!canAsk}>{busy ? '发送中...' : '发送'}</button></div>
              <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={e => { if (e.target.files) void addImageFiles(e.target.files); e.target.value = '' }} /><div className="attach-bar"><span className="meta">{images.length ? `已添加 ${images.length} 张（${fmtBytes(imageBytes)}）` : `可上传或粘贴图片，限制 ${data?.settings.imageMaxCount || 6} 张 / ${data?.settings.imageMaxMb || 8} MB`}</span>{images.length ? <button type="button" className="link-btn" onClick={clearImages} disabled={busy}>清空图片</button> : null}</div>{images.length ? <div className="img-grid" aria-label="已添加图片">{images.map(image => <div className="img-item" key={image.id}><img src={image.previewUrl} alt={image.name} /><button type="button" className="img-x" onClick={() => removeImage(image.id)} aria-label="移除图片">×</button></div>)}</div> : null}
              <textarea className="field mono grow ta" value={prompt} onChange={e => setPrompt(e.target.value)} onPaste={e => void addImageFiles(Array.from(e.clipboardData.files))} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void askOnce() } }} placeholder="输入你的问题...（Ctrl/⌘ + Enter 发送）" />{error ? <div className="meta error-text">{error}</div> : null}</section>
              <section className="pane output-pane"><div className="row dense"><strong className="card-title">输出</strong><span className="spacer" /><button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(answer)} disabled={!answer}>复制</button><button type="button" className="btn" onClick={() => { setPrompt(''); setAnswer(''); setError(null); clearImages() }} disabled={busy}>清空</button></div><pre className="out mono">{answer || (busy ? '正在请求 AI...' : '等待输出...')}</pre></section></div>
          </section>
        </section>
      ) : null}

      {modal === 'space' ? <Modal title="新建空间" onClose={() => setModal('')}><label className="field-wrap"><span>空间名称</span><input className="field" value={spaceName} onChange={e => setSpaceName(e.target.value)} /></label><div className="hr" /><button type="button" className="btn pri" onClick={() => { const tid = id('tpl'); void updateData(d => { d.spaces.unshift({ id: id('space'), name: spaceName.trim() || '新空间', createdAt: now(), updatedAt: now(), defaultModelByProvider: {}, activeTemplateId: tid, templates: [{ id: tid, name: '默认', systemPrompt: '' }] }) }); setModal('') }}>创建</button></Modal> : null}
      {modal === 'settings' && editing ? <SettingsModal data={editing} health={health} busy={busy} onChange={setEditing} onClose={() => setModal('')} onRefresh={refreshModels} onSave={async () => { await saveData(editing); setModal('') }} /> : null}
      {modal === 'templates' && editing && currentSpace ? <TemplatesModal data={editing} spaceId={currentSpace.id} onChange={setEditing} onClose={() => setModal('')} onSave={async () => { await saveData(editing); setModal('') }} /> : null}
      {error ? <section className="error-card">{error}</section> : null}
    </main>
  )
}

function SpacesView(props: { data: AppData | null; providerId: string; history: HistoryEntry[]; onOpen(id: string): void; onAdd(): void; onRename(id: string, name: string): void; onDelete(id: string): void; onMove(id: string, dir: number): void }) {
  return <section className="content list-content"><div className="row space-actions"><button type="button" className="btn pri" onClick={props.onAdd}>新建空间</button></div><div className="space-grid">{props.data?.spaces.map((space, index) => <div className="card space-card" key={space.id}><button type="button" className="space-open" onClick={() => props.onOpen(space.id)}><div className="row"><strong className="card-title">{space.name}</strong><span className="chip ok-chip">{space.templates.length} 模板</span></div><span className="meta">默认模型：<span className="mono">{defaultModel(space, props.providerId) || '未设置'}</span></span><span className="meta">历史：{props.history.filter(h => h.spaceId === space.id).length} 条</span></button><div className="row dense"><button type="button" className="btn" onClick={() => { const name = prompt('空间名称', space.name); if (name) props.onRename(space.id, name) }}>改名</button><button type="button" className="btn" disabled={index === 0} onClick={() => props.onMove(space.id, -1)}>上移</button><button type="button" className="btn" disabled={index === (props.data?.spaces.length || 1) - 1} onClick={() => props.onMove(space.id, 1)}>下移</button><button type="button" className="btn bad" onClick={() => confirm('删除空间？') && props.onDelete(space.id)}>删除</button></div></div>)}</div>{!props.data ? <div className="empty">后台启动中...</div> : null}</section>
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose(): void }) { return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><section className="modal card"><div className="row"><strong className="card-title">{title}</strong><span className="spacer" /><button type="button" className="btn" onClick={onClose}>关闭</button></div><div className="hr" />{children}</section></div> }

function SettingsModal({ data, health, busy, onChange, onClose, onRefresh, onSave }: { data: AppData; health: Record<string, unknown> | null; busy: boolean; onChange(data: AppData): void; onClose(): void; onRefresh(): void; onSave(): void }) {
  const active = activeProvider(data) || data.settings.providers[0]
  function mutate(recipe: (draft: AppData) => void) { const next = structuredClone(data) as AppData; recipe(next); onChange(next) }
  return <Modal title="供应商与图片设置" onClose={onClose}><div className="settings-grid"><label className="field-wrap"><span>供应商</span><select className="field" value={data.settings.activeProviderId} onChange={e => mutate(d => { d.settings.activeProviderId = e.target.value })}>{data.settings.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="field-wrap"><span>名称</span><input className="field" value={active.name} onChange={e => mutate(d => { const p = d.settings.providers.find(x => x.id === active.id); if (p) p.name = e.target.value })} /></label><label className="field-wrap"><span>Base URL</span><input className="field mono" value={active.baseUrl} onChange={e => mutate(d => { const p = d.settings.providers.find(x => x.id === active.id); if (p) { p.baseUrl = e.target.value; p.modelsCache = { items: [], fetchedAt: 0 } } })} /></label><label className="field-wrap"><span>API Key</span><input className="field mono" type="password" value={active.apiKey} onChange={e => mutate(d => { const p = d.settings.providers.find(x => x.id === active.id); if (p) p.apiKey = e.target.value })} /></label><label className="field-wrap"><span>图片张数</span><input className="field mono" type="number" min="1" value={data.settings.imageMaxCount} onChange={e => mutate(d => { d.settings.imageMaxCount = Math.max(1, Number(e.target.value) || 1) })} /></label><label className="field-wrap"><span>单图 MB</span><input className="field mono" type="number" min="0.5" step="0.5" value={data.settings.imageMaxMb} onChange={e => mutate(d => { d.settings.imageMaxMb = Math.max(0.5, Number(e.target.value) || 0.5) })} /></label></div><div className="hr" /><div className="row"><button type="button" className="btn" onClick={() => mutate(d => { const pid = id('prov'); d.settings.providers.unshift({ id: pid, name: '新供应商', baseUrl: 'https://api.openai.com/v1', apiKey: '', modelsCache: { items: [], fetchedAt: 0 } }); d.settings.activeProviderId = pid })}>新增供应商</button><button type="button" className="btn bad" disabled={data.settings.providers.length <= 1} onClick={() => mutate(d => { d.settings.providers = d.settings.providers.filter(p => p.id !== active.id); d.settings.activeProviderId = d.settings.providers[0].id })}>删除供应商</button><button type="button" className="btn" onClick={onRefresh} disabled={busy}>刷新模型</button><span className="spacer" /><button type="button" className="btn pri" onClick={onSave} disabled={busy}>保存</button></div><pre className="health-card mono">{JSON.stringify(health, null, 2) || '后台连接中'}</pre></Modal>
}

function TemplatesModal({ data, spaceId, onChange, onClose, onSave }: { data: AppData; spaceId: string; onChange(data: AppData): void; onClose(): void; onSave(): void }) {
  const space = data.spaces.find(s => s.id === spaceId) || data.spaces[0]
  function mutate(recipe: (space: Space) => void) { const next = structuredClone(data) as AppData; const s = next.spaces.find(x => x.id === space.id); if (s) { recipe(s); s.updatedAt = now() } onChange(next) }
  return <Modal title={`模板管理：${space.name}`} onClose={onClose}><div className="template-list">{space.templates.map(t => <div className="template-card card" key={t.id}><div className="row"><input className="field" value={t.name} onChange={e => mutate(s => { const hit = s.templates.find(x => x.id === t.id); if (hit) hit.name = e.target.value })} /><button type="button" className="btn" onClick={() => mutate(s => { s.activeTemplateId = t.id })}>{space.activeTemplateId === t.id ? '当前' : '切换'}</button><button type="button" className="btn bad" disabled={space.templates.length <= 1} onClick={() => mutate(s => { s.templates = s.templates.filter(x => x.id !== t.id); if (s.activeTemplateId === t.id) s.activeTemplateId = s.templates[0].id })}>删除</button></div><textarea className="field mono template-text" value={t.systemPrompt} onChange={e => mutate(s => { const hit = s.templates.find(x => x.id === t.id); if (hit) hit.systemPrompt = e.target.value })} /></div>)}</div><div className="hr" /><div className="row"><button type="button" className="btn" onClick={() => mutate(s => { const tid = id('tpl'); s.templates.unshift({ id: tid, name: '新模板', systemPrompt: '' }); s.activeTemplateId = tid })}>新增模板</button><span className="spacer" /><button type="button" className="btn pri" onClick={onSave}>保存</button></div></Modal>
}

const host = document.getElementById('app')
if (host) createRoot(host).render(<App />)
