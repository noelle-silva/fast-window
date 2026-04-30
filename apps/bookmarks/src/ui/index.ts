import { invoke } from '@tauri-apps/api/core'
import { createDirectBackgroundClient, type DirectBackgroundClient } from './directClient'

const DEFAULT_GROUP_ID = 'default'
const ALL_GROUPS = '__all__'

const Rpc = {
  list: 'bookmarks.list',
  inferIcon: 'bookmarks.inferIcon',
  addBookmark: 'bookmarks.add',
  updateBookmark: 'bookmarks.update',
  deleteBookmark: 'bookmarks.delete',
  openBookmark: 'bookmarks.open',
  refreshIcon: 'bookmarks.refreshIcon',
  addGroup: 'bookmarks.addGroup',
  renameGroup: 'bookmarks.renameGroup',
  deleteGroup: 'bookmarks.deleteGroup',
}

type BookmarkData = {
  schemaVersion: number
  groups: Array<{ id: string; name: string; createdAt: number }>
  items: Array<{ id: string; title: string; url: string; iconUrl?: string; groupId: string; createdAt: number; updatedAt: number; lastOpenedAt?: number | null }>
}

let bg: DirectBackgroundClient | null = null
let data: BookmarkData = { schemaVersion: 1, groups: [], items: [] }
let groupId = ALL_GROUPS
let search = ''

async function initBackground() {
  const endpoint = await invoke('backend_endpoint')
  bg = await createDirectBackgroundClient(endpoint)
}

async function call<T>(method: string, params?: unknown): Promise<T> {
  if (!bg) throw new Error('后台未连接')
  return bg.invoke<T>(method, params)
}

async function toast(message: string) {
  await invoke('app_toast', { message }).catch(() => {})
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function filteredItems() {
  const q = search.trim().toLowerCase()
  return data.items.filter(item => {
    if (groupId !== ALL_GROUPS && item.groupId !== groupId) return false
    if (!q) return true
    return item.title.toLowerCase().includes(q) || item.url.toLowerCase().includes(q)
  })
}

function render() {
  const root = document.getElementById('app') || document.body
  const groups = data.groups.slice().sort((a, b) => a.createdAt - b.createdAt)
  const items = filteredItems()

  root.innerHTML = `
    <style>
      * { box-sizing: border-box; }
      body { margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background:#FAFAFA; color:#212121; }
      .wrap { height:100vh; display:flex; flex-direction:column; }
      .topbar { height:44px; background:white; border-bottom:1px solid #e0e0e0; display:flex; align-items:center; gap:8px; padding:0 10px; box-shadow:0 1px 3px rgba(0,0,0,.12); }
      .title { font-weight:800; font-size:13px; margin-right:auto; }
      .btn { border:1px solid #e0e0e0; background:white; color:#212121; height:30px; padding:0 10px; border-radius:8px; cursor:pointer; font-size:12px; }
      .btn.primary { border-color:transparent; background:#1976d2; color:white; }
      .btn.danger { border-color:transparent; background:#d32f2f; color:white; }
      .filters { display:flex; gap:10px; padding:10px; }
      .field { display:flex; flex-direction:column; gap:6px; min-width:120px; }
      .field.grow { flex:1; min-width:0; }
      .label { font-size:11px; color:#757575; }
      select,input { height:34px; border:1px solid #e0e0e0; border-radius:10px; padding:0 10px; font-size:13px; outline:none; background:white; color:#212121; }
      .content { flex:1; overflow:auto; padding:10px; }
      .list { display:grid; grid-template-columns:repeat(auto-fill,minmax(96px,1fr)); gap:12px; align-content:start; }
      .tile { background:white; border:1px solid #e0e0e0; border-radius:12px; padding:12px 10px; box-shadow:0 1px 3px rgba(0,0,0,.12); cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:8px; }
      .tileName { font-weight:800; font-size:12px; width:100%; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .siteIcon { width:52px; height:52px; border-radius:999px; border:1px solid #e0e0e0; background:white; overflow:hidden; display:flex; align-items:center; justify-content:center; }
      .siteIcon img { width:100%; height:100%; display:block; }
      .empty { color:#757575; text-align:center; padding:28px 0; font-size:13px; }
      .modal { position:fixed; inset:0; background:rgba(0,0,0,.35); display:none; align-items:center; justify-content:center; padding:16px; }
      .modal.open { display:flex; }
      .card { width:min(560px,100%); background:white; border-radius:14px; overflow:hidden; box-shadow:0 10px 30px rgba(0,0,0,.25); }
      .cardHead { display:flex; align-items:center; gap:8px; padding:10px; border-bottom:1px solid #e0e0e0; }
      .cardTitle { font-size:13px; font-weight:800; margin-right:auto; }
      .cardBody { padding:10px; display:flex; flex-direction:column; gap:10px; }
      .row { display:flex; gap:10px; align-items:center; }
      .row .grow { flex:1; min-width:0; }
    </style>
    <div class="wrap">
      <div class="topbar" data-drag-region>
        <button class="btn" data-act="back" aria-label="返回">←</button>
        <div class="title">网站收藏</div>
        <button class="btn" data-act="groups">分组</button>
        <button class="btn primary" data-act="add">新增</button>
      </div>
      <div class="filters">
        <label class="field"><span class="label">分组</span><select data-act="group">${['<option value="__all__">全部</option>'].concat(groups.map(g => `<option value="${escapeHtml(g.id)}" ${g.id === groupId ? 'selected' : ''}>${escapeHtml(g.name)}</option>`)).join('')}</select></label>
        <label class="field grow"><span class="label">搜索</span><input data-act="search" value="${escapeHtml(search)}" placeholder="按标题 / URL 搜索" /></label>
      </div>
      <div class="content">
        ${items.length ? `<div class="list">${items.map(item => `<div class="tile" data-act="open" data-id="${escapeHtml(item.id)}" title="${escapeHtml(item.url)}"><div class="siteIcon">${item.iconUrl ? `<img src="${escapeHtml(item.iconUrl)}" referrerpolicy="no-referrer" />` : '🌐'}</div><div class="tileName">${escapeHtml(item.title || item.url)}</div><button class="btn" data-act="edit" data-id="${escapeHtml(item.id)}">编辑</button><button class="btn danger" data-act="delete" data-id="${escapeHtml(item.id)}">删除</button></div>`).join('')}</div>` : `<div class="empty">${search ? '未找到匹配的收藏' : '暂无收藏'}</div>`}
      </div>
    </div>
    <div class="modal" data-role="addModal"><div class="card"><div class="cardHead"><div class="cardTitle">新增收藏</div><button class="btn" data-act="closeModal">关闭</button></div><div class="cardBody"><input data-form="title" placeholder="标题（可选）" /><input data-form="url" placeholder="https://example.com" /><select data-form="group">${groups.map(g => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join('')}</select><div class="row"><button class="btn" data-act="closeModal">取消</button><button class="btn primary" data-act="saveAdd">保存</button></div></div></div></div>
  `
}

async function reload() {
  data = await call<BookmarkData>(Rpc.list, {})
  render()
}

function openAddModal() {
  const modal = document.querySelector('[data-role="addModal"]')
  modal?.classList.add('open')
}

function closeModal() {
  document.querySelector('[data-role="addModal"]')?.classList.remove('open')
}

document.addEventListener('click', async event => {
  const el = event.target as HTMLElement | null
  const act = el?.getAttribute('data-act')
  if (!act) return

  if (act === 'back') return invoke('app_hide').catch(() => {})
  if (act === 'add') return openAddModal()
  if (act === 'closeModal') return closeModal()
  if (act === 'open') {
    const id = el?.getAttribute('data-id') || ''
    await call(Rpc.openBookmark, { id })
    await reload()
    return
  }
  if (act === 'delete') {
    const id = el?.getAttribute('data-id') || ''
    if (!confirm('删除这条收藏？')) return
    await call(Rpc.deleteBookmark, { id })
    await reload()
    return
  }
  if (act === 'saveAdd') {
    const title = (document.querySelector('[data-form="title"]') as HTMLInputElement | null)?.value || ''
    const url = (document.querySelector('[data-form="url"]') as HTMLInputElement | null)?.value || ''
    const group = (document.querySelector('[data-form="group"]') as HTMLSelectElement | null)?.value || DEFAULT_GROUP_ID
    try {
      data = await call<BookmarkData>(Rpc.addBookmark, { title, url, groupId: group })
      closeModal()
      render()
      await toast('已添加')
    } catch (e: any) {
      await toast(String(e?.message || e || '添加失败'))
    }
  }
})

document.addEventListener('change', event => {
  const el = event.target as HTMLElement | null
  if (el?.getAttribute('data-act') === 'group') {
    groupId = (el as HTMLSelectElement).value || ALL_GROUPS
    render()
  }
})

document.addEventListener('input', event => {
  const el = event.target as HTMLElement | null
  if (el?.getAttribute('data-act') === 'search') {
    search = (el as HTMLInputElement).value || ''
    render()
  }
})

async function main() {
  await initBackground()
  await reload()
}

main().catch(error => {
  document.body.textContent = String(error?.message || error || '加载失败')
})
