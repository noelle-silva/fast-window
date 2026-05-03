import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { showToast } from '../fw-app-sdk/windowPolicy'
import { createDirectBackgroundClient, type DirectBackgroundClient } from './directClient'

// -- types & constants --------------------------------------------------------

const DEFAULT_GROUP_ID = 'default'
const ALL_GROUPS = '__all__'

type BookmarkData = {
  schemaVersion: number
  groups: Array<{ id: string; name: string; createdAt: number }>
  items: Array<{ id: string; title: string; url: string; iconUrl?: string; groupId: string; createdAt: number; updatedAt: number; lastOpenedAt?: number | null }>
}

type DataDirStatus = {
  dataDir: string
  defaultDataDir: string
  configuredDataDir?: string | null
  writable: boolean
  error?: string | null
}

// -- state -------------------------------------------------------------------

let bg: DirectBackgroundClient | null = null
let data: BookmarkData = { schemaVersion: 1, groups: [], items: [] }
let groupFilter = ALL_GROUPS
let search = ''
let modal: 'add' | 'edit' | 'groups' | null = null
let editId = ''
let addTitle = '', addUrl = '', addGroupId = DEFAULT_GROUP_ID, addIconUrl = ''
let ctxMenu: { open: boolean; id: string; x: number; y: number } = { open: false, id: '', x: 0, y: 0 }
let groupNameEdits: Record<string, string> = {}
let newGroupName = ''
let standaloneLaunch = false
let dataDirStatus: DataDirStatus | null = null
let bootstrapError = ''
let bootstrapping = true
let pendingLaunchCommand: string | null = null

// -- api helpers --------------------------------------------------------------

async function initBackground() {
  if (bg) {
    bg.close()
    bg = null
  }
  const endpoint: { url: string; token: string } = await invoke('backend_endpoint')
  bg = await createDirectBackgroundClient(endpoint)
}

async function refreshDataDirStatus() {
  dataDirStatus = await invoke<DataDirStatus>('data_dir_status').catch(error => ({
    dataDir: '',
    defaultDataDir: '',
    writable: false,
    error: String((error as any)?.message || error || '读取数据目录状态失败'),
  }))
}

async function call<T>(method: string, params?: unknown): Promise<T> {
  if (!bg) throw new Error('后台未连接')
  return bg.invoke<T>(method, params)
}

// -- utilities ----------------------------------------------------------------

function esc(v: unknown) {
  return String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function filteredItems() {
  const q = search.trim().toLowerCase()
  return data.items.filter(item => {
    if (groupFilter !== ALL_GROUPS && item.groupId !== groupFilter) return false
    if (!q) return true
    return item.title.toLowerCase().includes(q) || item.url.toLowerCase().includes(q)
  })
}

function closeCtx() { ctxMenu.open = false }

// -- render -------------------------------------------------------------------

function render() {
  const root = document.getElementById('app') || document.body
  const groups = data.groups.slice().sort((a, b) => a.createdAt - b.createdAt)
  const items = filteredItems()
  const controlsDisabled = bootstrapping || !!bootstrapError

  const css = `
    *{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#FAFAFA;color:#212121}
    .wrap{height:100vh;display:flex;flex-direction:column}
    .topbar{height:44px;background:#fff;border-bottom:1px solid #E0E0E0;display:flex;align-items:center;gap:8px;padding:0 10px;box-shadow:0 1px 3px rgba(0,0,0,.12);-webkit-app-region:drag;user-select:none}
    .title{font-weight:800;font-size:13px;margin-right:auto}
    .btn{border:1px solid #E0E0E0;background:#fff;color:#212121;height:30px;padding:0 10px;border-radius:8px;cursor:pointer;font-size:12px;-webkit-app-region:no-drag}
    .btn.primary{border-color:transparent;background:#1976D2;color:#fff}
    .btn.danger{border-color:transparent;background:#D32F2F;color:#fff}
    .btn[disabled]{opacity:.55;cursor:not-allowed}
    .windowControls{display:flex;align-items:center;gap:4px;-webkit-app-region:no-drag}
    .windowBtn{width:30px;height:30px;border:0;background:transparent;color:#424242;border-radius:8px;cursor:pointer;font-size:14px;line-height:30px;text-align:center;-webkit-app-region:no-drag}
    .windowBtn:hover{background:rgba(0,0,0,.08)}
    .windowBtn.close:hover{background:#D32F2F;color:#fff}
    .filters{display:flex;gap:10px;padding:10px}
    .field{display:flex;flex-direction:column;gap:6px;min-width:120px}
    .field.grow{flex:1;min-width:0}
    .label{font-size:11px;color:#757575}
    select,input{height:34px;border:1px solid #E0E0E0;border-radius:10px;padding:0 10px;font-size:13px;outline:none;background:#fff;color:#212121}
    .content{flex:1;overflow:auto;padding:10px}
    .list{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:12px;align-content:start}
    .tile{background:#fff;border:1px solid #E0E0E0;border-radius:12px;padding:12px 10px;box-shadow:0 1px 3px rgba(0,0,0,.12);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;user-select:none}
    .tileName{font-weight:800;font-size:12px;width:100%;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .siteIcon{width:52px;height:52px;border-radius:999px;border:1px solid #E0E0E0;background:#fff;overflow:hidden;display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .siteIcon img{width:100%;height:100%;display:block}
    .siteIcon.small{width:24px;height:24px;border-radius:6px}
    .empty{color:#757575;text-align:center;padding:28px 0;font-size:13px}
    .overlay{position:fixed;inset:0;background:rgba(0,0,0,.35);display:none;align-items:center;justify-content:center;padding:16px;z-index:40}
    .overlay.open{display:flex}
    .card{width:min(560px,100%);background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.25)}
    .cardHead{display:flex;align-items:center;gap:8px;padding:10px;border-bottom:1px solid #E0E0E0}
    .cardTitle{font-size:13px;font-weight:800;margin-right:auto}
    .cardBody{padding:10px;display:flex;flex-direction:column;gap:10px}
    .row{display:flex;gap:10px;align-items:center}
    .row .grow{flex:1;min-width:0}
    .help{font-size:12px;color:#757575}
    .statusPanel{margin:10px;padding:10px;border:1px solid #E0E0E0;border-radius:12px;background:#fff;display:flex;flex-direction:column;gap:8px;font-size:12px;color:#424242;-webkit-app-region:no-drag}
    .statusPanel.error{border-color:#EF9A9A;background:#FFF5F5;color:#B71C1C}
    .statusLine{display:flex;gap:8px;align-items:flex-start;word-break:break-all}
    .statusLabel{font-weight:800;flex-shrink:0;color:#616161}
    .statusActions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .groupRow{display:flex;gap:8px;align-items:center;padding:8px;border:1px solid #E0E0E0;border-radius:12px;background:#fff}
    .groupRow input{flex:1}
    .spacer{margin-left:auto}
    .ctxBackdrop{position:fixed;inset:0;background:transparent;z-index:50;display:none}
    .ctxBackdrop.open{display:block}
    .ctxMenu{position:fixed;z-index:60;min-width:160px;background:#fff;border:1px solid #E0E0E0;border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.22);padding:6px;display:none}
    .ctxMenu.open{display:block}
    .ctxItem{width:100%;height:34px;padding:0 10px;border:0;background:transparent;border-radius:10px;cursor:pointer;text-align:left;color:#212121;font-size:12px;display:flex;align-items:center;gap:8px}
    .ctxItem:hover{background:rgba(0,0,0,.06)}
    .ctxItem.danger{color:#D32F2F}
    .ctxSep{height:1px;background:#E0E0E0;margin:6px 4px}
    .loadingPanel{height:100%;min-height:220px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#616161;text-align:center}
    .spinner{width:28px;height:28px;border-radius:999px;border:3px solid #E3F2FD;border-top-color:#1976D2;animation:spin .8s linear infinite}
    .loadingTitle{font-size:13px;font-weight:800;color:#212121}
    .loadingHint{font-size:12px;color:#757575}
    @keyframes spin{to{transform:rotate(360deg)}}
  `

  root.innerHTML = `
    <style>${css}</style>
    <div class="wrap">
      <div class="topbar" data-tauri-drag-region="true">
        <button class="btn" data-act="back">←</button>
        <div class="title">网站收藏</div>
        <button class="btn" data-act="groups" ${controlsDisabled ? 'disabled' : ''}>分组</button>
        <button class="btn primary" data-act="add" ${controlsDisabled ? 'disabled' : ''}>新增</button>
        ${standaloneLaunch ? renderWindowControls() : ''}
      </div>
      <div class="filters">
        <label class="field"><span class="label">分组</span><select data-act="group" ${controlsDisabled ? 'disabled' : ''}>${['<option value="__all__">全部</option>'].concat(groups.map(g => `<option value="${esc(g.id)}" ${g.id === groupFilter ? 'selected' : ''}>${esc(g.name)}</option>`)).join('')}</select></label>
        <label class="field grow"><span class="label">搜索</span><input data-act="search" value="${esc(search)}" placeholder="按标题 / URL 搜索" ${controlsDisabled ? 'disabled' : ''} /></label>
      </div>
      ${renderDataDirPanel()}
      <div class="content">
        ${renderContent(items)}
      </div>
    </div>
    ${renderAddEditModal(groups)}
    ${renderGroupsModal(groups)}
    ${renderCtxMenu()}
  `
}

function renderContent(items: BookmarkData['items']) {
  if (bootstrapping) {
    return `
      <div class="loadingPanel" aria-live="polite">
        <div class="spinner" aria-hidden="true"></div>
        <div class="loadingTitle">正在启动网站收藏</div>
        <div class="loadingHint">窗口已就绪，收藏数据正在加载。</div>
      </div>
    `
  }
  if (!items.length) return `<div class="empty">${search ? '未找到匹配的收藏' : '暂无收藏'}</div>`
  return `<div class="list">${items.map(item => {
    const iconHtml = item.iconUrl ? `<img src="${esc(item.iconUrl)}" referrerpolicy="no-referrer" />` : '<span class="fallback">🌐</span>'
    return `<div class="tile" data-role="tile" data-id="${esc(item.id)}" title="${esc(item.url)}"><div class="siteIcon">${iconHtml}</div><div class="tileName">${esc(item.title || item.url)}</div></div>`
  }).join('')}</div>`
}

function renderDataDirPanel() {
  if (!dataDirStatus && !bootstrapError) return ''
  const status = dataDirStatus
  const hasError = !!bootstrapError || !!status?.error || status?.writable === false
  const dataDir = status?.dataDir || '未就绪'
  const error = status?.error || bootstrapError || ''
  return `
    <div class="statusPanel${hasError ? ' error' : ''}">
      <div class="statusLine"><span class="statusLabel">数据目录</span><span>${esc(dataDir)}</span></div>
      ${error ? `<div class="statusLine"><span class="statusLabel">问题</span><span>${esc(error)}</span></div>` : ''}
      <div class="statusActions">
        <button class="btn" data-act="pickDataDir">选择数据目录</button>
        ${status?.configuredDataDir ? `<span class="help">已使用自定义目录</span>` : `<span class="help">默认使用 App 旁边的 data 文件夹</span>`}
      </div>
    </div>
  `
}

function renderWindowControls() {
  return `
    <div class="windowControls" aria-label="窗口控制">
      <button class="windowBtn" data-act="winMinimize" title="最小化" aria-label="最小化">−</button>
      <button class="windowBtn" data-act="winToggleMaximize" title="最大化或还原" aria-label="最大化或还原">□</button>
      <button class="windowBtn close" data-act="winClose" title="关闭" aria-label="关闭">×</button>
    </div>
  `
}

function renderAddEditModal(groups: ReturnType<typeof data.groups.slice>) {
  const isEdit = !!editId
  const isOpen = modal === 'add' || modal === 'edit'
  return `
    <div class="overlay${isOpen ? ' open' : ''}" data-role="addModal">
      <div class="card">
        <div class="cardHead"><div class="cardTitle">${isEdit ? '编辑收藏' : '新增收藏'}</div><button class="btn" data-act="closeAdd">关闭</button></div>
        <div class="cardBody">
          <label class="field"><span class="label">标题（可选）</span><input data-act="addTitle" value="${esc(addTitle)}" placeholder="GitHub" /></label>
          <label class="field"><span class="label">URL</span><input data-act="addUrl" value="${esc(addUrl)}" placeholder="https://example.com" /></label>
          <div class="row">
            <div class="siteIcon small"><img data-role="addIconImg" referrerpolicy="no-referrer" src="${esc(addIconUrl)}" style="display:${addIconUrl ? 'block' : 'none'}" /><span class="fallback" style="display:${addIconUrl ? 'none' : 'block'}">🌐</span></div>
            <div class="help">后台推断 favicon</div>
            <div class="spacer"></div>
            <button class="btn" data-act="sniffAddIcon">推断图标</button>
            <button class="btn" data-act="clearAddIcon">清除</button>
          </div>
          <label class="field"><span class="label">分组</span><select data-act="addGroup">${groups.map(g => `<option value="${esc(g.id)}" ${g.id === addGroupId ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
          <div class="row"><div class="spacer"></div><button class="btn" data-act="closeAdd">取消</button><button class="btn primary" data-act="confirmAdd">${isEdit ? '保存' : '添加'}</button></div>
        </div>
      </div>
    </div>
  `
}

function renderGroupsModal(groups: ReturnType<typeof data.groups.slice>) {
  const isOpen = modal === 'groups'
  return `
    <div class="overlay${isOpen ? ' open' : ''}" data-role="groupsModal">
      <div class="card">
        <div class="cardHead"><div class="cardTitle">分组管理</div><button class="btn" data-act="closeGroups">关闭</button></div>
        <div class="cardBody">
          <div class="help">删除分组会把收藏移动到「默认」</div>
          <div data-area="groupsList">${groups.map(g => {
            const name = groupNameEdits[g.id] ?? g.name
            const locked = g.id === DEFAULT_GROUP_ID
            return `<div class="groupRow"><input data-act="groupName" data-id="${esc(g.id)}" value="${esc(name)}" /><button class="btn" data-act="saveGroup" data-id="${esc(g.id)}">保存</button>${locked ? '<button class="btn" disabled>锁定</button>' : `<button class="btn danger" data-act="delGroup" data-id="${esc(g.id)}">删除</button>`}</div>`
          }).join('')}</div>
          <div class="row grow"><input class="grow" data-act="newGroupName" value="${esc(newGroupName)}" placeholder="新分组名" /><button class="btn primary" data-act="addGroup">添加</button></div>
        </div>
      </div>
    </div>
  `
}

function renderCtxMenu() {
  const open = ctxMenu.open
  const style = open ? ` style="left:${ctxMenu.x}px;top:${ctxMenu.y}px"` : ''
  return `<div class="ctxBackdrop${open ? ' open' : ''}" data-role="ctxBackdrop"></div><div class="ctxMenu${open ? ' open' : ''}" data-role="ctxMenu"${style}><button class="ctxItem" data-act="ctxOpen">↗ 打开</button><button class="ctxItem" data-act="ctxEdit">✎ 编辑</button><button class="ctxItem" data-act="ctxSniff">⟳ 刷新图标</button><div class="ctxSep"></div><button class="ctxItem danger" data-act="ctxDelete">删除</button></div>`
}

// -- reload ------------------------------------------------------------------

async function reload() {
  data = await call<BookmarkData>('bookmarks.list', {})
  render()
}

// -- modal helpers -----------------------------------------------------------

function openModal(type: 'add' | 'edit' | 'groups') {
  modal = type
  if (type === 'add') {
    editId = ''; addTitle = ''; addUrl = ''; addIconUrl = ''; addGroupId = groupFilter === ALL_GROUPS ? DEFAULT_GROUP_ID : groupFilter
  }
  if (type === 'groups') { newGroupName = ''; groupNameEdits = {} }
  render()
}

function openEdit(id: string) {
  const item = data.items.find(i => i.id === id)
  if (!item) { showToast('条目不存在'); return }
  modal = 'edit'
  editId = id
  addTitle = item.title || ''
  addUrl = item.url || ''
  addGroupId = data.groups.some(g => g.id === item.groupId) ? item.groupId : DEFAULT_GROUP_ID
  addIconUrl = item.iconUrl || ''
  closeCtx()
  render()
}

function closeModal() {
  modal = null; editId = ''
  render()
}

function handleInitialCommand(command: string | null | undefined) {
  const id = String(command || '').trim()
  if (!id) return
  if (bootstrapping || bootstrapError) {
    pendingLaunchCommand = id
    return
  }

  if (id === 'add' || id === 'new' || id === 'new-bookmark') {
    openModal('add')
    showToast('已打开新增收藏')
    return
  }

  showToast(`未知命令：${id}`)
}

function flushPendingLaunchCommand() {
  const command = pendingLaunchCommand
  pendingLaunchCommand = null
  handleInitialCommand(command)
}

async function listenRuntimeCommands() {
  await listen<{ command?: string }>('fw-app-command', event => {
    handleInitialCommand(event.payload?.command)
  })
}

// -- events ------------------------------------------------------------------

document.addEventListener('click', async event => {
  const el = event.target as HTMLElement | null
  if (!el) return
  const act = el.getAttribute('data-act')

  // context-dismiss
  if (ctxMenu.open && !el.closest('[data-role="ctxMenu"]')) { closeCtx(); render() }

  if (act === 'back') return getCurrentWindow().hide()
  if (act === 'winMinimize') return getCurrentWindow().minimize()
  if (act === 'winToggleMaximize') return getCurrentWindow().toggleMaximize()
  if (act === 'winClose') return getCurrentWindow().hide()
  if (act === 'pickDataDir') {
    try {
      const picked = await invoke<DataDirStatus | null>('pick_data_dir')
      if (!picked) return
      dataDirStatus = picked
      bootstrapError = ''
      bootstrapping = true
      render()
      await initBackground()
      data = await call<BookmarkData>('bookmarks.list', {})
      bootstrapping = false
      render()
      flushPendingLaunchCommand()
      showToast('数据目录已更新')
    } catch (e: any) {
      bootstrapping = false
      bootstrapError = String(e?.message || e || '选择数据目录失败')
      await refreshDataDirStatus()
      render()
    }
    return
  }
  if (act === 'add') return openModal('add')
  if (act === 'groups') return openModal('groups')
  if (act === 'closeAdd' || act === 'closeGroups') return closeModal()

  if (act === 'confirmAdd') {
    const title = (document.querySelector('[data-act="addTitle"]') as HTMLInputElement)?.value || ''
    const url = (document.querySelector('[data-act="addUrl"]') as HTMLInputElement)?.value || ''
    const group = (document.querySelector('[data-act="addGroup"]') as HTMLSelectElement)?.value || DEFAULT_GROUP_ID
    try {
      if (editId) {
        data = await call<BookmarkData>('bookmarks.update', { id: editId, title, url, groupId: group, iconUrl: addIconUrl })
        showToast('已保存')
      } else {
        data = await call<BookmarkData>('bookmarks.add', { title, url, groupId: group, iconUrl: addIconUrl })
        showToast('已添加')
      }
      closeModal()
    } catch (e: any) { showToast(String(e?.message || e || '操作失败')) }
    return
  }

  if (act === 'sniffAddIcon') {
    const url = (document.querySelector('[data-act="addUrl"]') as HTMLInputElement)?.value || ''
    try {
      const r = await call<{ iconUrl: string }>('bookmarks.inferIcon', { url })
      addIconUrl = r?.iconUrl || ''
      render()
    } catch (e: any) { showToast(String(e?.message || e || '推断失败')) }
    return
  }

  if (act === 'clearAddIcon') { addIconUrl = ''; render(); return }

  if (act === 'addGroup') {
    const name = (document.querySelector('[data-act="newGroupName"]') as HTMLInputElement)?.value?.trim() || ''
    if (!name) { showToast('请输入分组名'); return }
    try { data = await call<BookmarkData>('bookmarks.addGroup', { name }); newGroupName = ''; render() }
    catch (e: any) { showToast(String(e?.message || e || '添加失败')) }
    return
  }

  if (act === 'saveGroup') {
    const groupId = el.getAttribute('data-id') || ''
    const name = (document.querySelector(`[data-act="groupName"][data-id="${groupId}"]`) as HTMLInputElement)?.value?.trim() || ''
    try { data = await call<BookmarkData>('bookmarks.renameGroup', { groupId, name }); render() }
    catch (e: any) { showToast(String(e?.message || e || '保存失败')) }
    return
  }

  if (act === 'delGroup') {
    const groupId = el.getAttribute('data-id') || ''
    if (!confirm('删除此分组？收藏将移到「默认」分组')) return
    try { data = await call<BookmarkData>('bookmarks.deleteGroup', { groupId }); render() }
    catch (e: any) { showToast(String(e?.message || e || '删除失败')) }
    return
  }

  // context menu actions
  if (act === 'ctxOpen') {
    const id = ctxMenu.id; closeCtx(); render()
    if (id) { await call('bookmarks.open', { id }); await reload() }
    return
  }
  if (act === 'ctxEdit') { const id = ctxMenu.id; if (id) openEdit(id); return }
  if (act === 'ctxSniff') {
    const id = ctxMenu.id; closeCtx(); render()
    if (id) { data = await call<BookmarkData>('bookmarks.refreshIcon', { id }); render() }
    return
  }
  if (act === 'ctxDelete') {
    const id = ctxMenu.id; closeCtx(); render()
    if (id && confirm('删除这条收藏？')) { data = await call<BookmarkData>('bookmarks.delete', { id }); render() }
    return
  }

  // tile open
  if (el.closest('[data-role="tile"]')) {
    const tile = el.closest('[data-role="tile"]') as HTMLElement
    const id = tile?.getAttribute('data-id') || ''
    if (id) { await call('bookmarks.open', { id }); await reload() }
  }
})

document.addEventListener('contextmenu', event => {
  if (modal) return
  const tile = (event.target as HTMLElement)?.closest?.('[data-role="tile"]') as HTMLElement | null
  if (!tile) return
  event.preventDefault()
  ctxMenu.open = true
  ctxMenu.id = tile.getAttribute('data-id') || ''
  ctxMenu.x = event.clientX
  ctxMenu.y = event.clientY
  render()
})

document.addEventListener('input', event => {
  const el = event.target as HTMLElement | null
  if (!el) return
  const act = el.getAttribute('data-act')
  if (act === 'search') { search = (el as HTMLInputElement).value || ''; render() }
  if (act === 'addTitle') { addTitle = (el as HTMLInputElement).value; return }
  if (act === 'addUrl') { addUrl = (el as HTMLInputElement).value; return }
  if (act === 'newGroupName') { newGroupName = (el as HTMLInputElement).value; return }
  if (act === 'groupName') {
    const id = el.getAttribute('data-id') || ''
    groupNameEdits[id] = (el as HTMLInputElement).value
    return
  }
})

document.addEventListener('change', event => {
  const el = event.target as HTMLElement | null
  if (!el) return
  const act = el.getAttribute('data-act')
  if (act === 'group') { groupFilter = (el as HTMLSelectElement).value || ALL_GROUPS; render() }
  if (act === 'addGroup') { addGroupId = (el as HTMLSelectElement).value; return }
})

// -- main --------------------------------------------------------------------

async function main() {
  const launchInfo = await invoke<{ standalone?: boolean }>('fw_launch_info').catch(() => ({ standalone: false }))
  standaloneLaunch = !!launchInfo?.standalone
  await listenRuntimeCommands()
  const command = await invoke<string | null>('fw_initial_command').catch(() => null)
  if (command) pendingLaunchCommand = command
  render()
  await invoke('app_ready')
  await refreshDataDirStatus()
  render()
  try {
    await initBackground()
    data = await call<BookmarkData>('bookmarks.list', {})
    bootstrapping = false
    bootstrapError = ''
    render()
    flushPendingLaunchCommand()
  } catch (error: any) {
    bootstrapping = false
    bootstrapError = String(error?.message || error || '后台未就绪')
    await refreshDataDirStatus()
    render()
    return
  }
}

main().catch(async error => {
  document.body.textContent = String(error?.message || error || '加载失败')
  await invoke('app_ready').catch(() => {})
})
