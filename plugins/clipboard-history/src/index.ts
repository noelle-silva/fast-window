import { startLegacyBackground } from './background/legacyBackground'
import { createClipboardHistoryGateway } from './gateway'
import { CLIPBOARD_PAGE_SIZE, TASK_KIND_CLIPBOARD_WATCH, TASK_QUERY_INTERVAL } from './shared/constants'
import { createClipboardHistoryUiState } from './ui/state'
import { styles } from './ui/styles'
import {
  buildParentMap as domainBuildParentMap,
  buildPathIds as domainBuildPathIds,
  canMoveInto as domainCanMoveInto,
  createFolder as domainCreateFolder,
  createItem as domainCreateItem,
  deleteNode as domainDeleteNode,
  deleteNodeRecursive as domainDeleteNodeRecursive,
  ensureCollections as domainEnsureCollections,
  findParentId as domainFindParentId,
  folderLabelById as domainFolderLabelById,
  getNode as domainGetNode,
  insertChild as domainInsertChild,
  isFolder as domainIsFolder,
  listChildren as domainListChildren,
  makeId as domainMakeId,
  moveNode as domainMoveNode,
  removeChild as domainRemoveChild,
  searchItems as domainSearchItems,
  traverseItemsUnder as domainTraverseItemsUnder,
  updateFolderName as domainUpdateFolderName,
  updateItem as domainUpdateItem,
} from './shared/collectionsDomain'
import {
  createEmptyInternalCopyMarker,
  createInternalCopyMarker,
  historyUniqKey as domainHistoryUniqKey,
  isDeleted as domainIsDeleted,
  isSameHistory as domainIsSameHistory,
  isWithinInternalCopyWindow,
  mergeHistoryItems as domainMergeHistoryItems,
  normalizeDeletedMap as domainNormalizeDeletedMap,
  normalizeHistoryItem as domainNormalizeHistoryItem,
  normalizeHistoryItems as domainNormalizeHistoryItems,
  normalizeHostSnapshotItems as domainNormalizeHostSnapshotItems,
  normalizeSettings as domainNormalizeSettings,
} from './shared/historyDomain'
import {
  basenameFromPath as domainBasenameFromPath,
  isDataUrl as domainIsDataUrl,
  isManagedClipboardImagePath as domainIsManagedClipboardImagePath,
  pickImagePath as domainPickImagePath,
} from './shared/imagePaths'

;(function () {
  const baseFastWindow = (window as any).fastWindow
  const gateway = createClipboardHistoryGateway(baseFastWindow)
  ;(window as any).fastWindow = baseFastWindow
  const runtime = gateway.runtime

  if (runtime === 'background') {
    startLegacyBackground(gateway)
    return
  }

  const state = createClipboardHistoryUiState()

  function internalWindowMs() {
    return Math.max(1500, state.settings.pollInterval * 2)
  }

  function now() {
    return Date.now()
  }

  function setInternalCopy(type, content) {
    state.internalCopy = createInternalCopyMarker(type, content)
  }

  function clearInternalCopy() {
    state.internalCopy = createEmptyInternalCopyMarker()
  }

  function withinInternalWindow() {
    return isWithinInternalCopyWindow(state.internalCopy, state.settings.pollInterval)
  }

  function historyUniqKey(item) {
    return domainHistoryUniqKey(item)
  }

  function normalizeDeletedMap(raw) {
    return domainNormalizeDeletedMap(raw)
  }

  function markDeleted(item) {
    if (!item || !item.type || !item.content) return
    state.deleted = normalizeDeletedMap({ ...(state.deleted || {}), [historyUniqKey(item)]: now() })
  }

  function isDeleted(item) {
    return domainIsDeleted(item, state.deleted)
  }

  function mergeHistoryItems(primary, secondary, limit = state.settings.maxHistory) {
    return domainMergeHistoryItems(primary, secondary, limit)
  }

  function isSameHistory(a, b) {
    return domainIsSameHistory(a, b)
  }

  function upsertHistoryItem(item) {
    state.history = mergeHistoryItems([item], state.history, state.settings.maxHistory)
  }

  function replaceInternalImageIfNeeded(internalContent, newContent) {
    if (!internalContent || internalContent === newContent) return
    const item = { type: 'image', content: newContent, time: now() }
    state.history = [item, ...state.history.filter((it) => !(it.type === 'image' && (it.content === internalContent || it.content === newContent)))]
      .slice(0, state.settings.maxHistory)
  }

  function normalizeSettings(raw) {
    return domainNormalizeSettings(raw)
  }

  function normalizeHistoryItem(raw) {
    return domainNormalizeHistoryItem(raw)
  }

  function normalizeHistoryItems(raw, limit = state.settings.maxHistory) {
    return domainNormalizeHistoryItems(raw, limit)
  }

  function normalizeHostSnapshotItems(result) {
    return domainNormalizeHostSnapshotItems(result, state.settings.maxHistory)
  }

  function stopMonitorQueryLoop() {
    if (state.monitorQueryTimer) {
      clearTimeout(state.monitorQueryTimer)
      state.monitorQueryTimer = null
    }
    state.monitorQuerying = false
  }

  function schedulePersistClipboard(delayMs = 120) {
    if (state.persistTimer) {
      clearTimeout(state.persistTimer)
      state.persistTimer = null
    }
    state.persistTimer = setTimeout(() => {
      state.persistTimer = null
      void persistClipboard()
    }, Math.max(0, Number(delayMs) || 0))
  }

  async function syncFromMonitorTaskSnapshot(task) {
    const result = task && task.result && typeof task.result === 'object' ? task.result : {}
    const snapshotItems = normalizeHostSnapshotItems(result).filter((it) => !isDeleted(it))
    const merged = mergeHistoryItems(
      (Array.isArray(state.history) ? state.history : []).filter((it) => !isDeleted(it)),
      snapshotItems,
      state.settings.maxHistory,
    )
    const changed = !isSameHistory(state.history, merged)
    if (changed) {
      state.history = merged
      schedulePersistClipboard()
      if (state.view === 'clipboard') renderClipboardList()
    }
    const firstText = state.history.find((it) => it && it.type === 'text' && it.content)
    if (firstText) state.currentText = firstText.content
    const firstImage = state.history.find((it) => it && it.type === 'image' && it.content)
    if (firstImage) state.currentImage = firstImage.content
  }

  async function queryMonitorTask(taskId) {
    if (!taskId || state.monitorTaskId !== taskId || state.monitorQuerying) return
    state.monitorQuerying = true
    try {
      const task = await gateway.monitor.getTask(taskId).catch(() => null)
      if (!task || state.monitorTaskId !== taskId) return

      const status = String(task.status || '')
      if (status === 'running' || status === 'queued') {
        await syncFromMonitorTaskSnapshot(task)
      }

      if (status === 'succeeded') {
        await syncFromMonitorTaskSnapshot(task)
        state.monitorTaskId = ''
        if (state.settings.autoMonitor) {
          await ensureMonitorTaskRunning(true)
        }
        return
      }

      if (status === 'failed' || status === 'canceled') {
        state.monitorTaskId = ''
        if (state.settings.autoMonitor) {
          await ensureMonitorTaskRunning(true)
        }
        return
      }

      state.monitorQueryTimer = setTimeout(() => {
        state.monitorQuerying = false
        queryMonitorTask(taskId)
      }, TASK_QUERY_INTERVAL)
      return
    } finally {
      state.monitorQuerying = false
    }
  }

  async function ensureMonitorTaskRunning(forceCreate = false) {
    stopMonitorQueryLoop()
    if (!state.settings.autoMonitor) {
      if (state.monitorTaskId) {
        await gateway.monitor.cancelTask(state.monitorTaskId).catch(() => {})
      }
      state.monitorTaskId = ''
      return
    }

    if (!forceCreate && state.monitorTaskId) {
      queryMonitorTask(state.monitorTaskId)
      return
    }

    if (state.monitorTaskId) {
      await gateway.monitor.cancelTask(state.monitorTaskId).catch(() => {})
      state.monitorTaskId = ''
    }

    const task = await gateway.monitor
      .startClipboardWatch({
        intervalMs: state.settings.pollInterval,
        maxHistory: state.settings.maxHistory,
      })
      .catch(() => null)
    const tid = String(task && task.id ? task.id : '').trim()
    if (!tid) return
    state.monitorTaskId = tid
    queryMonitorTask(tid)
  }

  function handleClipboardChange(type, content) {
    if (!content) return

    // 内部复制产生的剪贴板变化：不要再新增记录（避免重复）；图片可能被重编码，做一次替换
    if (withinInternalWindow() && state.internalCopy.type === type) {
      const internalContent = state.internalCopy.content
      clearInternalCopy()
      if (type === 'text') {
        state.currentText = content
        return
      }
      if (type === 'image') {
        replaceInternalImageIfNeeded(internalContent, content)
        state.currentImage = content
        return
      }
    }

    // 过期就清
    if (state.internalCopy.at && !withinInternalWindow()) clearInternalCopy()

    if (type === 'text') {
      if (content === state.currentText) return
      state.currentText = content
      upsertHistoryItem({ type: 'text', content, time: now() })
      return
    }

    if (type === 'image') {
      if (content === state.currentImage) return
      state.currentImage = content
      upsertHistoryItem({ type: 'image', content, time: now() })
      return
    }
  }

  async function persistClipboard() {
    try {
      await gateway.storage.saveHistory(state.history)
      await gateway.storage.saveSettings(state.settings)
      await gateway.storage.saveDeletedHistory(state.deleted)
    } catch (e) {}
  }

  async function persistCollections() {
    try {
      if (state.collections) await gateway.storage.saveCollections(state.collections)
      await gateway.storage.saveRecentFolders(state.recentFolders)
    } catch (e) {}
  }

  function makeId() {
    return domainMakeId()
  }

  function ensureCollections(saved) {
    return domainEnsureCollections(saved)
  }

  function getNode(id) {
    return domainGetNode(state.collections, id)
  }

  function isFolder(id) {
    return domainIsFolder(state.collections, id)
  }

  function buildParentMap() {
    return domainBuildParentMap(state.collections)
  }

  function buildPathIds(folderId) {
    return domainBuildPathIds(state.collections, folderId)
  }

  function folderLabelById(folderId) {
    return domainFolderLabelById(state.collections, folderId)
  }

  function touchRecentFolder(folderId) {
    if (!folderId || !isFolder(folderId)) return
    state.recentFolders = [folderId, ...state.recentFolders.filter((id) => id !== folderId)].slice(0, 10)
    persistCollections()
  }

  function openFolder(folderId) {
    if (!folderId || !isFolder(folderId)) return
    state.currentFolderId = folderId
    touchRecentFolder(folderId)
    render()
  }

  function navigateFolder(folderId) {
    if (!folderId || !isFolder(folderId)) return
    if (folderId === state.currentFolderId) return
    state.navBack = [...state.navBack, state.currentFolderId].slice(-50)
    state.navForward = []
    openFolder(folderId)
  }

  function navigateBack() {
    const prev = state.navBack[state.navBack.length - 1]
    if (!prev || !isFolder(prev)) return
    state.navBack = state.navBack.slice(0, -1)
    state.navForward = [state.currentFolderId, ...state.navForward].slice(0, 50)
    openFolder(prev)
  }

  function navigateForward() {
    const next = state.navForward[0]
    if (!next || !isFolder(next)) return
    state.navForward = state.navForward.slice(1)
    state.navBack = [...state.navBack, state.currentFolderId].slice(-50)
    openFolder(next)
  }

  function isDeleteArmed(nodeId) {
    return state.deleteArmedId === nodeId && state.deleteArmedAt && (now() - state.deleteArmedAt) < 2500
  }

  function refreshListsOnly() {
    if (state.view === 'clipboard') {
      renderClipboardList()
      return
    }
    renderFolderList()
  }

  function armDelete(nodeId) {
    state.deleteArmedId = nodeId
    state.deleteArmedAt = now()
    setTimeout(() => {
      if (isDeleteArmed(nodeId)) {
        state.deleteArmedId = ''
        state.deleteArmedAt = 0
        refreshListsOnly()
      }
    }, 2600)
  }

  function hash32Sampled(s) {
    const str = String(s || '')
    const n = str.length
    const sample = n > 4096 ? (str.slice(0, 2048) + str.slice(-2048)) : str
    let h = 5381
    for (let i = 0; i < sample.length; i++) {
      h = ((h << 5) + h) ^ sample.charCodeAt(i)
    }
    return (h >>> 0).toString(16).padStart(8, '0')
  }

  function historyKey(item) {
    const type = item && item.type ? String(item.type) : 'text'
    const content = item && item.content ? String(item.content) : ''
    return `hist:${type}:${hash32Sampled(content)}`
  }

  function canMoveInto(targetFolderId, movingId) {
    return domainCanMoveInto(state.collections, targetFolderId, movingId)
  }

  function removeChild(parentId, childId) {
    domainRemoveChild(state.collections, parentId, childId)
  }

  function insertChild(parentId, childId, index) {
    domainInsertChild(state.collections, parentId, childId, index)
  }

  function findParentId(childId) {
    return domainFindParentId(state.collections, childId)
  }

  function moveNode(movingId, toParentId, toIndex) {
    if (!domainMoveNode(state.collections, movingId, toParentId, toIndex)) return false
    persistCollections()
    return true
  }

  function deleteNodeRecursive(nodeId) {
    domainDeleteNodeRecursive(state.collections, nodeId)
  }

  function deleteNode(nodeId) {
    if (!domainDeleteNode(state.collections, nodeId)) return
    persistCollections()
  }

  function createFolder(parentId, name) {
    const folderId = domainCreateFolder(state.collections, parentId, name)
    if (!folderId) return ''
    persistCollections()
    return folderId
  }

  function createItem(parentId, title, content) {
    const itemId = domainCreateItem(state.collections, parentId, title, content)
    if (!itemId) return ''
    persistCollections()
    return itemId
  }

  function updateFolderName(folderId, name) {
    if (!domainUpdateFolderName(state.collections, folderId, name)) return false
    persistCollections()
    return true
  }

  function updateItem(itemId, title, content) {
    if (!domainUpdateItem(state.collections, itemId, title, content)) return false
    persistCollections()
    return true
  }

  function listChildren(folderId) {
    return domainListChildren(state.collections, folderId)
  }

  function traverseItemsUnder(folderId) {
    return domainTraverseItemsUnder(state.collections, folderId)
  }

  function searchItems(query, scope) {
    return domainSearchItems(state.collections, query, scope, state.currentFolderId)
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;')
  }

  function formatTime(ts) {
    try {
      const d = new Date(ts)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    } catch {
      return ''
    }
  }

  function closeOverlays() {
    state.ctxMenu.open = false
    state.ctxMenu.nodeId = ''
    state.movePicker.open = false
    state.movePicker.movingId = ''
    state.movePicker.query = ''
    state.movePicker.action = 'move'
    state.editDialog.open = false
    state.editDialog.nodeId = ''
    state.editDialog.folderName = ''
    state.editDialog.itemTitle = ''
    state.editDialog.itemContent = ''
  }

  function renderMovePickerList() {
    const list = document.querySelector('[data-area="movePickList"]')
    if (!(list instanceof HTMLElement)) return
    if (!state.collections) return

    const movingId = state.movePicker.movingId
    const moving = getNode(movingId)
    if (!moving || (moving.type !== 'folder' && moving.type !== 'item')) {
      list.innerHTML = '<div class="menuHeader">无效的条目</div>'
      return
    }

    const q = (state.movePicker.query || '').trim().toLowerCase()
    const folders = Object.values(state.collections.nodes || {})
      .filter((n) => n && n.type === 'folder')
      .map((n) => n.id)
      .filter((id) => canMoveInto(id, movingId))
      .map((id) => ({ id, label: folderLabelById(id) }))
      .filter((x) => (q ? x.label.toLowerCase().includes(q) : true))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'))

    if (!folders.length) {
      list.innerHTML = '<div class="menuHeader">没有可用的目标收藏夹</div>'
      return
    }

    list.innerHTML = folders
      .map((f) => `<button class="menuItem" data-act="movePickTarget" data-id="${escapeHtml(f.id)}">📁 ${escapeHtml(f.label)}</button>`)
      .join('')
  }

  function fitCtxMenuIntoViewport() {
    const el = document.querySelector('[data-role="ctxMenu"]')
    if (!(el instanceof HTMLElement)) return
    const pad = 8
    const rect = el.getBoundingClientRect()
    const maxX = Math.max(pad, window.innerWidth - rect.width - pad)
    const maxY = Math.max(pad, window.innerHeight - rect.height - pad)
    const x = Math.max(pad, Math.min(state.ctxMenu.x, maxX))
    const y = Math.max(pad, Math.min(state.ctxMenu.y, maxY))
    el.style.left = `${x}px`
    el.style.top = `${y}px`
  }

  function renderOverlay() {
    const overlay = document.querySelector('[data-area="overlay"]')
    if (!(overlay instanceof HTMLElement)) return

    if (state.view !== 'folders') closeOverlays()

    if (state.editDialog.open && state.editDialog.nodeId) {
      const n = getNode(state.editDialog.nodeId)
      if (!n || (n.type !== 'folder' && n.type !== 'item')) {
        closeOverlays()
        overlay.className = 'overlay'
        overlay.innerHTML = ''
        return
      }

      const dialogTitle = n.type === 'folder' ? '编辑收藏夹' : '编辑条目'
      const body =
        n.type === 'folder'
          ? `
            <input class="input" placeholder="收藏夹名称" data-act="editFolderName" value="${escapeHtml(state.editDialog.folderName)}" />
          `
          : `
            <input class="input" placeholder="备注（标题）" data-act="editItemTitle" value="${escapeHtml(state.editDialog.itemTitle)}" />
            <textarea class="textarea" placeholder="正文内容（不能为空）" data-act="editItemContent">${escapeHtml(state.editDialog.itemContent)}</textarea>
          `

      overlay.className = 'overlay open'
      overlay.innerHTML = `
        <div class="backdrop" data-act="closeOverlay"></div>
        <div class="dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(dialogTitle)}">
          <div class="dialogHeader">
            <div class="dialogTitle">${escapeHtml(dialogTitle)}</div>
            <span class="spacer"></span>
            <button class="btn" data-act="editCancel">取消</button>
            <button class="btn primary" data-act="editSave">保存</button>
          </div>
          <div class="dialogBody">${body}</div>
        </div>
      `

      const focusEl = overlay.querySelector('input[data-act="editFolderName"], input[data-act="editItemTitle"], textarea[data-act="editItemContent"]')
      if (focusEl instanceof HTMLElement) {
        setTimeout(() => {
          try {
            focusEl.focus()
            if (focusEl instanceof HTMLInputElement || focusEl instanceof HTMLTextAreaElement) {
              focusEl.setSelectionRange(focusEl.value.length, focusEl.value.length)
            }
          } catch {}
        }, 0)
      }
      return
    }

    if (state.movePicker.open) {
      const moving = getNode(state.movePicker.movingId)
      const action = state.movePicker.action === 'copy' ? 'copy' : 'move'
      const isFolderMove = !!moving && moving.type === 'folder' && action === 'move'
      const kindLabel = moving && moving.type === 'folder' ? '收藏夹' : '条目'
      const name = moving && moving.type === 'folder' ? moving.name : moving && moving.type === 'item' ? (moving.title || '') : ''
      const dialogTitle = `${action === 'copy' ? '复制' : '移动'}${kindLabel}`
      const hintVerb = action === 'copy' ? '复制到' : '移动到'
      overlay.className = 'overlay open'
      overlay.innerHTML = `
        <div class="backdrop" data-act="closeOverlay"></div>
        <div class="dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(dialogTitle)}">
          <div class="dialogHeader">
            <div class="dialogTitle">${escapeHtml(dialogTitle)}</div>
            <span class="spacer"></span>
            <button class="btn" data-act="movePickCancel">取消</button>
          </div>
          <div class="dialogBody">
            <div class="hint">
              <span>将「${escapeHtml(name)}」${hintVerb}：</span>
              ${isFolderMove ? '<span>不能移动到自身或子收藏夹</span>' : ''}
            </div>
            <input class="input" placeholder="搜索目标收藏夹（按路径）" data-act="movePickQuery" value="${escapeHtml(state.movePicker.query)}" />
            <div class="dialogList" data-area="movePickList"></div>
          </div>
        </div>
      `
      renderMovePickerList()
      const input = overlay.querySelector('input[data-act="movePickQuery"]')
      if (input instanceof HTMLInputElement) {
        setTimeout(() => {
          try {
            input.focus()
            input.setSelectionRange(input.value.length, input.value.length)
          } catch {}
        }, 0)
      }
      return
    }

    if (state.ctxMenu.open && state.ctxMenu.nodeId) {
      const n = getNode(state.ctxMenu.nodeId)
      if (!n || (n.type !== 'folder' && n.type !== 'item')) {
        closeOverlays()
        overlay.className = 'overlay'
        overlay.innerHTML = ''
        return
      }
      const items =
        n.type === 'item'
          ? `
            <button class="menuItem" data-act="ctxEdit">✏️ 编辑</button>
            <button class="menuItem" data-act="ctxCopyTo">📋 复制到...</button>
            <button class="menuItem" data-act="ctxMoveTo">📁 移动到...</button>
          `
          : `
            <button class="menuItem" data-act="ctxEdit">✏️ 编辑</button>
            <button class="menuItem" data-act="ctxMoveTo">📁 移动到...</button>
          `
      overlay.className = 'overlay open'
      overlay.innerHTML = `
        <div class="backdrop" data-act="closeOverlay"></div>
        <div class="ctxMenu" data-role="ctxMenu" style="left:${state.ctxMenu.x}px;top:${state.ctxMenu.y}px">
          ${items}
        </div>
      `
      requestAnimationFrame(fitCtxMenuIntoViewport)
      return
    }

    overlay.className = 'overlay'
    overlay.innerHTML = ''
  }

  function mount() {
    const root = document.getElementById('app') || document.body

    const drag = {
      active: false,
      id: '',
      originEl: null,
      listEl: null,
      placeholder: null,
      ghost: null,
      lastX: 0,
      lastY: 0,
      lastReorderAt: 0,
    }

    root.innerHTML = `
      <style>${styles}</style>
      <div class="wrap">
        <div class="topbar" data-area="topbar"></div>
        <div class="content">
          <div data-page="clipboard" data-area="clipboardPage">
            <div class="settings" data-area="settings" style="display:none"></div>
            <div class="list" data-area="clipboardList"></div>
            <div class="empty" data-area="clipboardEmpty" style="display:none"></div>
          </div>
          <div data-page="folders" data-area="foldersPage" style="display:none">
            <div class="subbar" data-area="foldersSubbar"></div>
            <div class="editor" data-area="itemEditor" style="display:none"></div>
            <div class="list" data-area="folderList"></div>
            <div class="empty" data-area="folderEmpty" style="display:none"></div>
          </div>
        </div>
      </div>
      <div class="overlay" data-area="overlay"></div>
    `

    const topbar = root.querySelector('.topbar')
    if (topbar) {
      topbar.addEventListener('pointerdown', (e) => {
        if (!(e instanceof PointerEvent)) return
        if (e.button !== 0) return
        const t = e.target
        if (!(t instanceof HTMLElement)) return
        if (t.closest('button, a, input, textarea, select, [role="button"]')) return
        void gateway.host.startDragging()
      })
    }

    root.addEventListener('click', async (e) => {
      const t = e.target
      if (!(t instanceof Element)) return

      const actEl = t.closest?.('[data-act]')
      const act = actEl ? actEl.getAttribute('data-act') : ''
      if (act === 'toggleExpandHistory') {
        const hid = (actEl && actEl.getAttribute('data-hid')) || ''
        if (!hid) return
        if (state.clipboardExpanded[hid]) delete state.clipboardExpanded[hid]
        else state.clipboardExpanded[hid] = true
        renderClipboardList()
        return
      }
      if (act === 'closeOverlay') {
        closeOverlays()
        renderOverlay()
        return
      }
      if (act === 'editCancel') {
        closeOverlays()
        renderOverlay()
        return
      }
      if (act === 'editSave') {
        const nodeId = state.editDialog.nodeId
        const n = getNode(nodeId)
        if (!n || (n.type !== 'folder' && n.type !== 'item')) {
          closeOverlays()
          renderOverlay()
          return
        }

        let ok = false
        if (n.type === 'folder') ok = updateFolderName(nodeId, state.editDialog.folderName)
        else ok = updateItem(nodeId, state.editDialog.itemTitle, state.editDialog.itemContent)

        if (!ok) {
          void gateway.host.toast(n.type === 'folder' ? '名称不能为空' : '正文内容不能为空')
          return
        }

        void gateway.host.toast('已保存')
        closeOverlays()
        render()
        return
      }
      if (act === 'movePickCancel') {
        closeOverlays()
        renderOverlay()
        return
      }
      if (act === 'ctxEdit') {
        const nodeId = state.ctxMenu.nodeId
        const n = getNode(nodeId)
        closeOverlays()
        if (!n || (n.type !== 'folder' && n.type !== 'item')) {
          renderOverlay()
          return
        }
        state.editDialog.open = true
        state.editDialog.nodeId = nodeId
        if (n.type === 'folder') {
          state.editDialog.folderName = String(n.name || '')
          state.editDialog.itemTitle = ''
          state.editDialog.itemContent = ''
        } else {
          state.editDialog.folderName = ''
          state.editDialog.itemTitle = String(n.title || '')
          state.editDialog.itemContent = String(n.content || '')
        }
        renderOverlay()
        return
      }
      if (act === 'ctxMoveTo') {
        const movingId = state.ctxMenu.nodeId
        const n = getNode(movingId)
        closeOverlays()
        if (n && (n.type === 'folder' || n.type === 'item')) {
          state.movePicker.open = true
          state.movePicker.movingId = movingId
          state.movePicker.query = ''
          state.movePicker.action = 'move'
        }
        renderOverlay()
        return
      }
      if (act === 'ctxCopyTo') {
        const movingId = state.ctxMenu.nodeId
        const n = getNode(movingId)
        closeOverlays()
        if (n && n.type === 'item') {
          state.movePicker.open = true
          state.movePicker.movingId = movingId
          state.movePicker.query = ''
          state.movePicker.action = 'copy'
        }
        renderOverlay()
        return
      }
      if (act === 'movePickTarget') {
        const toParentId = (actEl && actEl.getAttribute('data-id')) || ''
        const movingId = state.movePicker.movingId
        const action = state.movePicker.action === 'copy' ? 'copy' : 'move'
        const moving = getNode(movingId)
        let ok = false
        if (action === 'copy') {
          if (moving && moving.type === 'item') {
            ok = !!createItem(toParentId, moving.title, moving.content)
          }
        } else {
          ok = moveNode(movingId, toParentId)
        }
        if (ok) void gateway.host.toast(`${action === 'copy' ? '已复制到' : '已移动到'}：${folderLabelById(toParentId)}`)
        else void gateway.host.toast(`${action === 'copy' ? '复制失败' : '移动失败'}`)
        closeOverlays()
        renderOverlay()
        renderFolderList()
        return
      }
      if (act === 'back') {
        void gateway.host.back()
        return
      }
      if (act === 'openFolders') {
        state.view = 'folders'
        state.showSettings = false
        state.showRecentMenu = false
        detachClipboardSentinelObserver()
        render()
        return
      }
      if (act === 'openClipboard') {
        state.view = 'clipboard'
        state.showSettings = false
        state.showRecentMenu = false
        state.clipboardLimit = CLIPBOARD_PAGE_SIZE
        render()
        return
      }
      if (act === 'toggleRecent') {
        state.showRecentMenu = !state.showRecentMenu
        render()
        return
      }
      if (act === 'toggleMore') {
        state.showMoreMenu = !state.showMoreMenu
        render()
        return
      }
      if (act === 'openRecentFolder') {
        const folderId = (actEl && actEl.getAttribute('data-id')) || ''
        state.view = 'folders'
        state.showRecentMenu = false
        openFolder(folderId)
        return
      }
      if (act === 'toggleSettings') {
        state.showSettings = !state.showSettings
        state.showMoreMenu = false
        render()
        return
      }
      if (act === 'clearHistory') {
        state.showMoreMenu = false
        const armed = state.clearArmedAt && (now() - state.clearArmedAt) < 2500
        if (!armed) {
          state.clearArmedAt = now()
          void gateway.host.toast('再点一次清空')
          renderTopbar()
          return
        }
        state.clearArmedAt = 0
        const toDelete = Array.isArray(state.history) ? state.history.slice() : []
        const tasks = []
        for (const it of toDelete) {
          if (!it || it.type !== 'image') continue
          tasks.push(tryDeleteManagedImageFile(it))
        }
        await Promise.allSettled(tasks)
        state.history = []
        state.clipboardExpanded = {}
        state.clipboardImageCache = {}
        state.clipboardImageLoading = {}
        state.clipboardLimit = CLIPBOARD_PAGE_SIZE
        await persistClipboard()
        restartMonitor()
        void gateway.host.toast('已清空')
        render()
        return
      }

      if (act === 'toggleFolderEditor') {
        state.showFolderEditor = !state.showFolderEditor
        state.showItemEditor = false
        state.draftTitle = ''
        state.draftContent = ''
        if (!state.showFolderEditor) state.draftFolderName = ''
        render()
        return
      }
      if (act === 'saveFolder') {
        const id = createFolder(state.currentFolderId, state.draftFolderName)
        if (id) {
          state.showFolderEditor = false
          state.draftFolderName = ''
          void gateway.host.toast('已创建收藏夹')
        }
        render()
        return
      }
      if (act === 'cancelFolder') {
        state.showFolderEditor = false
        state.draftFolderName = ''
        render()
        return
      }
      if (act === 'toggleItemEditor') {
        state.showItemEditor = !state.showItemEditor
        state.showFolderEditor = false
        state.draftFolderName = ''
        if (!state.showItemEditor) {
          state.draftTitle = ''
          state.draftContent = ''
        }
        render()
        return
      }
      if (act === 'saveItem') {
        const id = createItem(state.currentFolderId, state.draftTitle, state.draftContent)
        if (id) {
          state.showItemEditor = false
          state.draftTitle = ''
          state.draftContent = ''
          void gateway.host.toast('已添加条目')
        }
        render()
        return
      }
      if (act === 'cancelItem') {
        state.showItemEditor = false
        state.draftTitle = ''
        state.draftContent = ''
        render()
        return
      }
      if (act === 'toggleFolderSearchScope') {
        state.folderSearchScope = state.folderSearchScope === 'global' ? 'current' : 'global'
        render()
        return
      }
      if (act === 'navBack') {
        navigateBack()
        return
      }
      if (act === 'navForward') {
        navigateForward()
        return
      }
      if (act === 'crumb') {
        const folderId = (actEl && actEl.getAttribute('data-id')) || ''
        navigateFolder(folderId)
        return
      }
      if (act === 'openFolder') {
        const folderId = (actEl && actEl.getAttribute('data-id')) || ''
        navigateFolder(folderId)
        return
      }
      if (act === 'deleteNode') {
        const nodeId = (actEl && actEl.getAttribute('data-id')) || ''
        const n = getNode(nodeId)
        if (!n) return
        if (!isDeleteArmed(nodeId)) {
          armDelete(nodeId)
          void gateway.host.toast('再点一次删除')
          renderFolderList()
          return
        }
        state.deleteArmedId = ''
        state.deleteArmedAt = 0
        deleteNode(nodeId)
        void gateway.host.toast('已删除')
        renderFolderList()
        return
      }
      if (act === 'copyFolderItem') {
        const itemId = (actEl && actEl.getAttribute('data-id')) || ''
        const it = getNode(itemId)
        if (!it || it.type !== 'item') return
        try {
          await gateway.clipboard.writeText(it.content)
          void gateway.host.toast('复制成功')
        } catch (e) {}
        return
      }
      if (act === 'openItemFolder') {
        const folderId = (actEl && actEl.getAttribute('data-folder-id')) || ''
        if (!folderId) return
        state.folderSearchQuery = ''
        navigateFolder(folderId)
        return
      }

      if (state.showRecentMenu && !t.closest?.('[data-role="recentDropdown"]')) {
        state.showRecentMenu = false
        renderTopbar()
        return
      }
      if (state.showMoreMenu && !t.closest?.('[data-role="moreDropdown"]')) {
        state.showMoreMenu = false
        renderTopbar()
        return
      }

      const clipCard = t.closest?.('[data-role="clipboardCard"]')
      if (clipCard) {
        const hid = clipCard.getAttribute('data-hid') || ''
        const item = state.history.find((it) => historyKey(it) === hid)
        if (!item) return

        if (act === 'delHistory') {
          const key = historyKey(item)
          if (!isDeleteArmed(key)) {
            armDelete(key)
            void gateway.host.toast('再点一次删除')
            renderClipboardList()
            return
          }
          state.deleteArmedId = ''
          state.deleteArmedAt = 0
          markDeleted(item)
          state.history = state.history.filter((h) => historyKey(h) !== key)
          if (state.clipboardExpanded[key]) delete state.clipboardExpanded[key]
          if (state.clipboardImageCache[key]) delete state.clipboardImageCache[key]
          if (state.clipboardImageLoading[key]) delete state.clipboardImageLoading[key]
          await tryDeleteManagedImageFile(item)
          await persistClipboard()
          void gateway.host.toast('已删除')
          renderClipboardList()
          return
        }

        try {
          setInternalCopy(item.type, item.content)
          if (item.type === 'image') {
            const hidKey = historyKey(item)
            let dataUrl = ''
            if (isDataUrl(item.content)) {
              dataUrl = item.content
            } else if (state.clipboardImageCache[hidKey]) {
              dataUrl = state.clipboardImageCache[hidKey]
            } else {
              const path = pickImagePath(item)
              if (path) {
                dataUrl = await gateway.images.readOutputImage(path).catch(() => '')
                if (dataUrl) state.clipboardImageCache[hidKey] = dataUrl
              }
            }
            if (!dataUrl) throw new Error('image not available')
            await gateway.clipboard.writeImage(dataUrl)
          } else {
            await gateway.clipboard.writeText(item.content)
          }

          const newItem = { ...item, time: now() }
          if (item.type === 'image') state.currentImage = item.content
          else state.currentText = item.content

          upsertHistoryItem(newItem)

          await persistClipboard()
          void gateway.host.toast('复制成功')
          renderClipboardList()
        } catch (err) {
          clearInternalCopy()
        }
        return
      }

      const folderCard = t.closest?.('[data-role="folderCard"]')
      if (folderCard) {
        const nodeId = folderCard.getAttribute('data-id') || ''
        const n = getNode(nodeId)
        if (!n) return
        if (n.type === 'folder') {
          navigateFolder(nodeId)
          return
        }
        if (n.type === 'item') {
          try {
            await gateway.clipboard.writeText(n.content)
            void gateway.host.toast('复制成功')
          } catch (e) {}
          return
        }
      }
    })

    root.addEventListener('contextmenu', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (state.view !== 'folders') return
      if (state.ctxMenu.open || state.movePicker.open || state.editDialog.open) {
        e.preventDefault()
        return
      }

      const card = t.closest?.('[data-role="folderCard"]')
      if (!(card instanceof HTMLElement)) return
      const nodeId = card.getAttribute('data-id') || ''
      const n = getNode(nodeId)
      if (!n || (n.type !== 'folder' && n.type !== 'item')) return

      e.preventDefault()
      state.showRecentMenu = false
      state.showMoreMenu = false
      state.ctxMenu.open = true
      state.ctxMenu.nodeId = nodeId
      state.ctxMenu.x = e.clientX
      state.ctxMenu.y = e.clientY
      renderTopbar()
      renderOverlay()
    })

    root.addEventListener('input', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const act = t.getAttribute('data-act')
      if (act === 'searchClipboard') {
        state.clipboardSearchQuery = (t instanceof HTMLInputElement ? t.value : '') || ''
        state.clipboardLimit = CLIPBOARD_PAGE_SIZE
        renderClipboardList()
        return
      }
      if (act === 'searchFolders') {
        state.folderSearchQuery = (t instanceof HTMLInputElement ? t.value : '') || ''
        renderFolderList()
        return
      }
      if (act === 'movePickQuery') {
        state.movePicker.query = (t instanceof HTMLInputElement ? t.value : '') || ''
        renderMovePickerList()
        return
      }
      if (act === 'editFolderName') {
        state.editDialog.folderName = (t instanceof HTMLInputElement ? t.value : '') || ''
        return
      }
      if (act === 'editItemTitle') {
        state.editDialog.itemTitle = (t instanceof HTMLInputElement ? t.value : '') || ''
        return
      }
      if (act === 'editItemContent') {
        state.editDialog.itemContent = (t instanceof HTMLTextAreaElement ? t.value : '') || ''
        return
      }
      if (act === 'draftTitle') {
        state.draftTitle = (t instanceof HTMLInputElement ? t.value : '') || ''
        return
      }
      if (act === 'draftFolderName') {
        state.draftFolderName = (t instanceof HTMLInputElement ? t.value : '') || ''
        return
      }
      if (act === 'draftContent') {
        state.draftContent = (t instanceof HTMLTextAreaElement ? t.value : '') || ''
      }
    })

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return
      if (!state.ctxMenu.open && !state.movePicker.open && !state.editDialog.open) return
      closeOverlays()
      renderOverlay()
    })

    function endDrag(commit) {
      if (!drag.active) return
      drag.active = false

      if (commit && drag.id && state.collections && state.view === 'folders' && !state.folderSearchQuery.trim()) {
        if (isFolder(state.currentFolderId) && drag.listEl instanceof HTMLElement) {
          let insertIndex = 0
          const children = Array.from(drag.listEl.children)
          for (const el of children) {
            if (el === drag.placeholder) break
            if (!(el instanceof HTMLElement)) continue
            if (el.getAttribute('data-role') !== 'folderCard') continue
            const id = el.getAttribute('data-id') || ''
            if (id && id !== drag.id) insertIndex += 1
          }
          moveNode(drag.id, state.currentFolderId, insertIndex)
        }
        render()
      }

      if (drag.originEl instanceof HTMLElement) {
        drag.originEl.style.display = ''
      }

      if (drag.ghost instanceof HTMLElement) drag.ghost.remove()
      if (drag.placeholder instanceof HTMLElement) drag.placeholder.remove()

      drag.id = ''
      drag.originEl = null
      drag.listEl = null
      drag.placeholder = null
      drag.ghost = null
    }

    function onPointerMove(e) {
      if (!drag.active) return
      if (!(drag.ghost instanceof HTMLElement)) return

      drag.ghost.style.transform = `translate(${e.clientX + 10}px, ${e.clientY + 10}px)`

      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (!(el instanceof HTMLElement)) return

      const list = drag.listEl
      if (!(list instanceof HTMLElement)) return

      // 防止“占位符追着鼠标跑”导致过度敏感：需要明显移动/节流才重排
      const moved = Math.abs(e.clientX - drag.lastX) + Math.abs(e.clientY - drag.lastY)
      const tNow = now()
      drag.lastX = e.clientX
      drag.lastY = e.clientY
      if (moved < 3) return
      if (drag.lastReorderAt && (tNow - drag.lastReorderAt) < 60) return

      function snapshot(listEl) {
        const map = new Map()
        for (const el of Array.from(listEl.children)) {
          if (!(el instanceof HTMLElement)) continue
          if (el.getAttribute('data-role') !== 'folderCard') continue
          if (el.style.display === 'none') continue
          map.set(el, el.getBoundingClientRect())
        }
        return map
      }

      function playFlip(first, listEl) {
        for (const el of Array.from(listEl.children)) {
          if (!(el instanceof HTMLElement)) continue
          if (el.getAttribute('data-role') !== 'folderCard') continue
          if (el.style.display === 'none') continue
          const a = first.get(el)
          if (!a) continue
          const b = el.getBoundingClientRect()
          const dx = a.left - b.left
          const dy = a.top - b.top
          if (!dx && !dy) continue
          if (typeof el.animate === 'function') {
            el.animate(
              [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
              { duration: 140, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
            )
          } else {
            el.style.transition = 'transform 0s'
            el.style.transform = `translate(${dx}px, ${dy}px)`
            requestAnimationFrame(() => {
              el.style.transition = 'transform 140ms cubic-bezier(0.2, 0, 0, 1)'
              el.style.transform = 'translate(0, 0)'
              setTimeout(() => {
                el.style.transition = ''
                el.style.transform = ''
              }, 160)
            })
          }
        }
      }

      const card = el.closest?.('[data-role="folderCard"]')
      if (card instanceof HTMLElement && card !== drag.originEl) {
        const first = snapshot(list)
        const rect = card.getBoundingClientRect()
        const before = e.clientY < rect.top + rect.height / 2
        list.insertBefore(drag.placeholder, before ? card : card.nextSibling)
        playFlip(first, list)
        drag.lastReorderAt = tNow
        return
      }

      // 空白区域：放到末尾
      if (el.closest?.('[data-area="folderList"]')) {
        const first = snapshot(list)
        list.appendChild(drag.placeholder)
        playFlip(first, list)
        drag.lastReorderAt = tNow
      }
    }

    function onPointerUp() {
      if (!drag.active) return
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      endDrag(true)
    }

    root.addEventListener('pointerdown', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (state.view !== 'folders') return
      if (state.folderSearchQuery.trim()) return

      const handle = t.closest?.('[data-role="dragHandle"]')
      if (!handle) return
      const card = t.closest?.('[data-role="folderCard"]')
      if (!(card instanceof HTMLElement)) return
      const nodeId = card.getAttribute('data-id') || ''
      if (!nodeId) return

      const list = document.querySelector('[data-area="folderList"]')
      if (!(list instanceof HTMLElement)) return

      drag.active = true
      drag.id = nodeId
      drag.originEl = card
      drag.listEl = list
      drag.lastX = e.clientX
      drag.lastY = e.clientY
      drag.lastReorderAt = 0

      const ph = document.createElement('div')
      ph.className = 'placeholder'
      ph.style.height = `${Math.max(36, card.getBoundingClientRect().height)}px`
      drag.placeholder = ph

      list.insertBefore(ph, card.nextSibling)
      card.style.display = 'none'

      const ghost = card.cloneNode(true)
      if (ghost instanceof HTMLElement) {
        ghost.classList.add('ghost')
        ghost.style.width = `${Math.max(240, card.getBoundingClientRect().width)}px`
        document.body.appendChild(ghost)
        drag.ghost = ghost
        ghost.style.transform = `translate(${e.clientX + 10}px, ${e.clientY + 10}px)`
      }

      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      e.preventDefault()
    })
  }

  function renderSettings() {
    const area = document.querySelector('[data-area="settings"]')
    if (!(area instanceof HTMLElement)) return
    if (!state.showSettings) {
      area.style.display = 'none'
      return
    }
    area.style.display = 'block'
    area.innerHTML = `
      <div class="row">
        <label>自动监控</label>
        <button class="btn ${state.settings.autoMonitor ? 'primary' : ''}" data-act="toggleAuto">${state.settings.autoMonitor ? '开启' : '关闭'}</button>
      </div>
      <div class="row">
        <label>轮询间隔(ms)</label>
        <input type="number" min="200" step="100" value="${state.settings.pollInterval}" data-act="pollInterval" />
      </div>
      <div class="row">
        <label>最大记录数</label>
        <input type="number" min="10" step="10" value="${state.settings.maxHistory}" data-act="maxHistory" />
      </div>
      <div class="row">
        <label>折叠行数</label>
        <input type="number" min="1" step="1" value="${state.settings.collapseLines}" data-act="collapseLines" />
      </div>
      <div class="row">
        <button class="btn primary" data-act="saveSettings">保存</button>
      </div>
    `

    area.onclick = async (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const act = t.getAttribute('data-act')
      if (act === 'toggleAuto') {
        state.settings = normalizeSettings({
          ...state.settings,
          autoMonitor: !state.settings.autoMonitor,
        })
        await persistClipboard()
        restartMonitor()
        render()
      }
      if (act === 'saveSettings') {
        const poll = area.querySelector('input[data-act="pollInterval"]')
        const maxH = area.querySelector('input[data-act="maxHistory"]')
        const collapse = area.querySelector('input[data-act="collapseLines"]')
        const pollInterval = poll instanceof HTMLInputElement ? Number(poll.value) : state.settings.pollInterval
        const maxHistory = maxH instanceof HTMLInputElement ? Number(maxH.value) : state.settings.maxHistory
        const collapseLines = collapse instanceof HTMLInputElement ? Number(collapse.value) : state.settings.collapseLines
        state.settings = normalizeSettings({
          ...state.settings,
          pollInterval,
          maxHistory,
          collapseLines,
        })
        state.history = normalizeHistoryItems(state.history, state.settings.maxHistory)
        await persistClipboard()
        restartMonitor()
        render()
      }
    }
  }

  function renderTopbar() {
    const topbar = document.querySelector('[data-area="topbar"]')
    if (!(topbar instanceof HTMLElement)) return

    if (state.view === 'clipboard') {
      topbar.innerHTML = `
        <button class="btn" data-act="back" aria-label="返回主页" title="返回主页">←</button>
        <div class="title">剪贴板历史</div>
        <input class="search" placeholder="搜索文本（图片不参与）" data-act="searchClipboard" value="${escapeHtml(state.clipboardSearchQuery)}" />
        <div class="dropdown" data-role="recentDropdown">
          <button class="btn" data-act="toggleRecent">最近收藏夹 ▾</button>
          <div class="menu ${state.showRecentMenu ? 'open' : ''}">
            <div class="menuHeader">最近打开（最多10个）</div>
            ${
              state.recentFolders.length
                ? state.recentFolders
                    .filter((id) => isFolder(id))
                    .map((id) => `<button class="menuItem" data-act="openRecentFolder" data-id="${escapeHtml(id)}">📁 ${escapeHtml(folderLabelById(id))}</button>`)
                    .join('')
                : `<div class="menuHeader">暂无</div>`
            }
          </div>
        </div>
        <span class="spacer"></span>
        <div class="dropdown" data-role="moreDropdown">
          <button class="btn" data-act="toggleMore">⋮</button>
          <div class="menu ${state.showMoreMenu ? 'open' : ''}">
            <div class="menuHeader">更多</div>
            <button class="menuItem" data-act="toggleSettings">⚙ 设置</button>
            <button class="menuItem" data-act="clearHistory">🗑 清空历史</button>
          </div>
        </div>
        <button class="btn folders" data-act="openFolders">收藏夹</button>
      `
      return
    }

    topbar.innerHTML = `
      <button class="btn" data-act="back" aria-label="返回主页" title="返回主页">←</button>
      <div class="title">收藏夹</div>
      <input class="search" placeholder="${state.folderSearchScope === 'global' ? '全局搜索（标题/内容）' : '当前收藏夹内搜索（含子收藏夹）'}" data-act="searchFolders" value="${escapeHtml(state.folderSearchQuery)}" />
      <button class="btn" data-act="toggleFolderSearchScope">${state.folderSearchScope === 'global' ? '全局' : '当前'}</button>
      <span class="spacer"></span>
      <button class="btn primary" data-act="openClipboard">剪贴板</button>
    `
  }

  function isDataUrl(s) {
    return domainIsDataUrl(s)
  }

  function pickImagePath(item) {
    return domainPickImagePath(item)
  }

  function basenameFromPath(path) {
    return domainBasenameFromPath(path)
  }

  function isManagedClipboardImagePath(path) {
    return domainIsManagedClipboardImagePath(path)
  }

  async function tryDeleteManagedImageFile(item) {
    if (!item || item.type !== 'image') return
    const path = pickImagePath(item)
    if (!path) return
    if (!isManagedClipboardImagePath(path)) return
    await gateway.images.deleteOutputImage(path).catch(() => {})
  }

  let clipboardSentinelObserver = null

  function detachClipboardSentinelObserver() {
    try {
      clipboardSentinelObserver?.disconnect?.()
    } catch (e) {}
    clipboardSentinelObserver = null
  }

  function attachClipboardSentinelObserver(listEl, total, limit) {
    detachClipboardSentinelObserver()
    if (!(listEl instanceof HTMLElement)) return
    if (limit >= total) return

    const sentinel = listEl.querySelector('[data-role="clipboardSentinel"]')
    if (!(sentinel instanceof HTMLElement)) return

    const root = document.querySelector('.content')
    const rootEl = root instanceof HTMLElement ? root : null

    clipboardSentinelObserver = new IntersectionObserver(
      (entries) => {
        const hit = entries && entries[0] && entries[0].isIntersecting
        if (!hit) return
        detachClipboardSentinelObserver()
        const next = Math.min(state.settings.maxHistory, limit + CLIPBOARD_PAGE_SIZE, total)
        if (next <= limit) return
        state.clipboardLimit = next
        renderClipboardList()
      },
      {
        root: rootEl,
        rootMargin: '240px 0px',
        threshold: 0,
      },
    )

    try {
      clipboardSentinelObserver.observe(sentinel)
    } catch (e) {}
  }

  function renderClipboardList() {
    const listEl = document.querySelector('[data-area="clipboardList"]')
    const emptyEl = document.querySelector('[data-area="clipboardEmpty"]')
    if (!(listEl instanceof HTMLElement) || !(emptyEl instanceof HTMLElement)) return

    const q = state.clipboardSearchQuery.trim().toLowerCase()
    let list = state.history
    if (q) {
      list = list.filter((it) => it.type !== 'image' && String(it.content).toLowerCase().includes(q))
    }

    const total = list.length
    if (!total) {
      detachClipboardSentinelObserver()
      listEl.innerHTML = ''
      listEl.style.display = 'none'
      emptyEl.style.display = 'block'
      emptyEl.textContent = q ? '没有匹配的内容' : '剪贴板历史为空'
      return
    }

    const limit = Math.min(total, Math.max(1, Number(state.clipboardLimit) || CLIPBOARD_PAGE_SIZE))
    const visible = list.slice(0, limit)
    const hasMore = limit < total

    listEl.style.display = 'flex'
    emptyEl.style.display = 'none'

    listEl.innerHTML =
      visible
        .map((it) => {
          const typeLabel = it.type === 'image' ? '图片' : '文本'
          const timeLabel = it.time ? formatTime(it.time) : ''
          const key = historyKey(it)
          const expanded = !!state.clipboardExpanded[key]
          const tools = `
            <div class="clipTools">
              <span class="meta">${escapeHtml(typeLabel)}</span>
              <span class="meta">${escapeHtml(timeLabel)}</span>
              <button class="iconBtn" data-act="delHistory" title="${isDeleteArmed(key) ? '再点一次确认删除' : '删除'}">${isDeleteArmed(key) ? '⚠' : '🗑'}</button>
            </div>`

          if (it.type === 'image') {
            const directDataUrl = isDataUrl(it.content) ? it.content : ''
            const cached = state.clipboardImageCache[key] || directDataUrl || ''
            const body = `
              <div class="textWrap">
                <div class="imgWrap">
                  ${tools}
                  <div class="imgPlaceholder" data-role="imgPh" data-hid="${escapeHtml(key)}" style="${cached ? 'display:none' : ''}">加载中...</div>
                  <img class="img" data-role="lazyImg" data-hid="${escapeHtml(key)}" style="${cached ? '' : 'display:none'}" src="${cached ? escapeHtml(cached) : ''}" />
                  <div class="pill">🖼 图片</div>
                </div>
              </div>`
            return `<div class="card" data-role="clipboardCard" data-hid="${escapeHtml(key)}">${body}</div>`
          }

          const textClass = expanded ? 'text' : 'text clamp'
          const btnClass = expanded ? 'foldBtn' : 'foldBtn hidden'
          const btnLabel = expanded ? '收起' : '展开'
          const body = `
            <div class="textWrap clipTextWrap">
              <div class="${textClass}" data-role="clipText" style="--clamp-lines:${state.settings.collapseLines}">${escapeHtml(it.content || '')}</div>
              ${tools}
              <button class="${btnClass}" data-role="foldBtn" data-act="toggleExpandHistory" data-hid="${escapeHtml(key)}">${btnLabel}</button>
            </div>`
          return `<div class="card" data-role="clipboardCard" data-hid="${escapeHtml(key)}">${body}</div>`
        })
        .join('') +
      (hasMore ? `<div class="loadMoreRow" data-role="clipboardSentinel"><span class="pill">继续下滑加载更多（${limit}/${total}）</span></div>` : '')

    attachClipboardSentinelObserver(listEl, total, limit)

    requestAnimationFrame(() => {
      try {
        const texts = listEl.querySelectorAll('[data-role="clipText"].clamp')
        for (const el of texts) {
          if (!(el instanceof HTMLElement)) continue
          const btn = el.parentElement?.querySelector?.('button[data-role="foldBtn"]')
          if (!(btn instanceof HTMLElement)) continue
          const overflow = el.scrollHeight > el.clientHeight + 1
          if (overflow) btn.classList.remove('hidden')
          else btn.classList.add('hidden')
        }
      } catch (e) {}

      try {
        const imgs = listEl.querySelectorAll('img[data-role="lazyImg"]')
        for (const img of imgs) {
          if (!(img instanceof HTMLImageElement)) continue
          const hid = img.getAttribute('data-hid') || ''
          if (!hid) continue
          if (state.clipboardImageCache[hid]) continue
          if (state.clipboardImageLoading[hid]) continue
          const item = state.history.find((it) => historyKey(it) === hid)
          if (!item || item.type !== 'image') continue

          const cached = state.clipboardImageCache[hid] || ''
          if (cached) continue
          if (isDataUrl(item.content)) {
            state.clipboardImageCache[hid] = item.content
            img.src = item.content
            img.style.display = ''
            const ph = img.parentElement?.querySelector?.('[data-role="imgPh"]')
            if (ph instanceof HTMLElement) ph.style.display = 'none'
            continue
          }

          const path = pickImagePath(item)
          if (!path) {
            const ph = img.parentElement?.querySelector?.('[data-role="imgPh"]')
            if (ph instanceof HTMLElement) ph.textContent = '图片不可用'
            continue
          }

          state.clipboardImageLoading[hid] = true
          void gateway.images
            .readOutputImage(path)
            .then((dataUrl) => {
              const v = String(dataUrl || '')
              if (!v) return
              state.clipboardImageCache[hid] = v
              img.src = v
              img.style.display = ''
              const ph = img.parentElement?.querySelector?.('[data-role="imgPh"]')
              if (ph instanceof HTMLElement) ph.style.display = 'none'
            })
            .catch(() => {
              const ph = img.parentElement?.querySelector?.('[data-role="imgPh"]')
              if (ph instanceof HTMLElement) ph.textContent = '加载失败'
            })
            .finally(() => {
              state.clipboardImageLoading[hid] = false
            })
        }
      } catch (e) {}
    })
  }

  function renderFoldersSubbar() {
    const sub = document.querySelector('[data-area="foldersSubbar"]')
    if (!(sub instanceof HTMLElement)) return
    if (!state.collections) return

    const pathIds = buildPathIds(state.currentFolderId)
    const crumbs = pathIds
      .map((id) => {
        const n = getNode(id)
        const name = n && n.type === 'folder' ? n.name : ''
        return `<span class="crumb" data-act="crumb" data-id="${escapeHtml(id)}">${escapeHtml(name)}</span>`
      })
      .join(`<span class="pill">/</span>`)

    sub.innerHTML = `
      <div class="crumbs">${crumbs}</div>
      <span class="spacer"></span>
      <button class="btn" data-act="navBack" ${state.navBack.length ? '' : 'disabled'} title="后退">←</button>
      <button class="btn" data-act="navForward" ${state.navForward.length ? '' : 'disabled'} title="前进">→</button>
      <button class="btn" data-act="toggleFolderEditor">${state.showFolderEditor ? '收起新建' : '新建收藏夹'}</button>
      <button class="btn primary" data-act="toggleItemEditor">${state.showItemEditor ? '收起输入' : '新建条目'}</button>
      ${
        state.showFolderEditor
          ? `
            <div class="fieldRow" style="width:100%">
              <input class="input" placeholder="收藏夹名称" data-act="draftFolderName" value="${escapeHtml(state.draftFolderName)}" />
              <button class="btn primary" data-act="saveFolder">创建</button>
              <button class="btn" data-act="cancelFolder">取消</button>
            </div>
          `
          : ''
      }
    `
  }

  function renderItemEditor() {
    const area = document.querySelector('[data-area="itemEditor"]')
    if (!(area instanceof HTMLElement)) return
    if (!state.showItemEditor) {
      area.style.display = 'none'
      return
    }
    area.style.display = 'block'
    area.innerHTML = `
      <div class="fieldRow">
        <input class="input" placeholder="标题（可选）" data-act="draftTitle" value="${escapeHtml(state.draftTitle)}" />
        <button class="btn primary" data-act="saveItem">添加</button>
        <button class="btn" data-act="cancelItem">取消</button>
      </div>
      <textarea class="textarea" placeholder="输入要收藏的纯文本内容" data-act="draftContent">${escapeHtml(state.draftContent)}</textarea>
      <div class="hint">
        <span>提示：条目卡片点击即可复制</span>
        <span>拖拽卡片排序（仅排序，不支持移入）</span>
      </div>
    `
  }

  function renderFolderList() {
    const listEl = document.querySelector('[data-area="folderList"]')
    const emptyEl = document.querySelector('[data-area="folderEmpty"]')
    if (!(listEl instanceof HTMLElement) || !(emptyEl instanceof HTMLElement)) return
    if (!state.collections) return

    const q = (state.folderSearchQuery || '').trim()
    const results = q ? searchItems(q, state.folderSearchScope) : []

    if (q) {
      if (!results.length) {
        listEl.innerHTML = ''
        listEl.style.display = 'none'
        emptyEl.style.display = 'block'
        emptyEl.textContent = '没有匹配的内容'
        return
      }

      emptyEl.style.display = 'none'
      listEl.style.display = 'flex'
      listEl.innerHTML = results
        .map(({ item, folderId, path }) => {
          const top = `
            <div class="cardTop">
              <span class="pill">文本</span>
              <span class="pill">${escapeHtml(path)}</span>
              <span class="spacer"></span>
              <button class="iconBtn" data-act="openItemFolder" data-folder-id="${escapeHtml(folderId)}" title="打开所在收藏夹">📂</button>
              <button class="iconBtn" data-act="copyFolderItem" data-id="${escapeHtml(item.id)}" title="复制">📋</button>
            </div>`
          const body = `<div class="text">${escapeHtml(item.content || '')}</div>`
          return `<div class="card" data-role="folderCard" data-id="${escapeHtml(item.id)}">${top}${body}</div>`
        })
        .join('')
      return
    }

    const children = listChildren(state.currentFolderId)
    if (!children.length) {
      listEl.innerHTML = ''
      listEl.style.display = 'none'
      emptyEl.style.display = 'block'
      emptyEl.textContent = '当前收藏夹为空'
      return
    }

    emptyEl.style.display = 'none'
    listEl.style.display = 'flex'
    listEl.innerHTML = children
      .map((n) => {
        if (n.type === 'folder') {
          const count = Array.isArray(n.children) ? n.children.length : 0
          const top = `
            <div class="cardTop">
              <span class="dragHandle" title="拖拽排序" data-role="dragHandle">⋮⋮</span>
              <div class="folderCardTitle">
                <span class="pill">📁</span>
                <span class="folderName">${escapeHtml(n.name)}</span>
              </div>
              <span class="pill">${count} 项</span>
              <span class="spacer"></span>
              <button class="iconBtn" data-act="deleteNode" data-id="${escapeHtml(n.id)}" title="${isDeleteArmed(n.id) ? '再点一次确认删除' : '删除'}">${isDeleteArmed(n.id) ? '⚠' : '🗑'}</button>
            </div>`
          return `<div class="card" data-role="folderCard" data-id="${escapeHtml(n.id)}">${top}</div>`
        }

        const top = `
          <div class="cardTop">
            <span class="dragHandle" title="拖拽排序" data-role="dragHandle">⋮⋮</span>
            <span class="pill">文本</span>
            <span class="pill">${escapeHtml(n.title || '')}</span>
            <span class="spacer"></span>
            <button class="iconBtn" data-act="copyFolderItem" data-id="${escapeHtml(n.id)}" title="复制">📋</button>
            <button class="iconBtn" data-act="deleteNode" data-id="${escapeHtml(n.id)}" title="${isDeleteArmed(n.id) ? '再点一次确认删除' : '删除'}">${isDeleteArmed(n.id) ? '⚠' : '🗑'}</button>
          </div>`
        const body = `<div class="text">${escapeHtml(n.content || '')}</div>`
        return `<div class="card" data-role="folderCard" data-id="${escapeHtml(n.id)}">${top}${body}</div>`
      })
      .join('')
  }

  function render() {
    renderTopbar()

    const clipboardPage = document.querySelector('[data-area="clipboardPage"]')
    const foldersPage = document.querySelector('[data-area="foldersPage"]')
    if (clipboardPage instanceof HTMLElement) clipboardPage.style.display = state.view === 'clipboard' ? 'block' : 'none'
    if (foldersPage instanceof HTMLElement) foldersPage.style.display = state.view === 'folders' ? 'block' : 'none'

    if (state.view === 'clipboard') {
      renderSettings()
      renderClipboardList()
      renderOverlay()
      return
    }

    renderFoldersSubbar()
    renderItemEditor()
    renderFolderList()
    renderOverlay()
  }

  function restartMonitor() {
    void ensureMonitorTaskRunning(true)
  }

  async function init() {
    try {
      const [savedHistory, savedSettings, savedDeleted, savedCollections, savedRecent] = await Promise.all([
        gateway.storage.loadHistory(),
        gateway.storage.loadSettings(),
        gateway.storage.loadDeletedHistory(),
        gateway.storage.loadCollections(),
        gateway.storage.loadRecentFolders(),
      ])

      state.settings = normalizeSettings(savedSettings)
      const normalizedHistory = normalizeHistoryItems(savedHistory, state.settings.maxHistory)
      state.history = normalizedHistory
      state.deleted = normalizeDeletedMap(savedDeleted)
      state.history = (Array.isArray(state.history) ? state.history : []).filter((it) => !isDeleted(it))
      state.collections = ensureCollections(savedCollections)
      state.currentFolderId = state.collections.rootId || 'root'
      if (Array.isArray(savedRecent)) state.recentFolders = savedRecent.filter((x) => typeof x === 'string')
      if (!savedCollections) await persistCollections()
      if (!savedDeleted || state.history.length !== normalizedHistory.length) await persistClipboard()

      const firstText = state.history.find((it) => it && it.type === 'text' && it.content)
      if (firstText) state.currentText = firstText.content
      const firstImage = state.history.find((it) => it && it.type === 'image' && it.content)
      if (firstImage) state.currentImage = firstImage.content
    } catch (e) {}

    mount()
    render()

    const recentTasks = await gateway.monitor.listRecentTasks(20).catch(() => [])
    const runningTask = Array.isArray(recentTasks)
      ? recentTasks.find((t) => {
          const status = String(t && t.status ? t.status : '')
          const kind = String(t && t.kind ? t.kind : '')
          return (status === 'queued' || status === 'running') && kind === TASK_KIND_CLIPBOARD_WATCH
        })
      : null
    state.monitorTaskId = runningTask && runningTask.id ? String(runningTask.id) : ''

    await ensureMonitorTaskRunning(false)
  }

  init()
})()
