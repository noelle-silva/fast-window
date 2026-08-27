import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  type Bookmark,
  downloadIconDataUrl,
  httpRequestBase64,
  isHttpUrl,
  normalizeUrl,
  rasterizeToPngDataUrl,
  saveIconPngToFile,
  showToast as toast,
  sniffIconUrl,
  uid,
} from './bookmarkUtils'

type FormState = {
  id: string
  title: string
  url: string
  iconUrl: string
  iconDataUrl: string
  iconCleared: boolean
}

type CtxMenu = {
  open: boolean
  id: string
  url: string
  x: number
  y: number
}

type Reorder = {
  pointerId: number | null
  draggingId: string
  overId: string
  startX: number
  startY: number
  moved: boolean
}

function emptyForm(): FormState {
  return { id: '', title: '', url: '', iconUrl: '', iconDataUrl: '', iconCleared: false }
}

function normalizeBookmark(raw: unknown): Bookmark | null {
  const x = (raw && typeof raw === 'object' ? raw : {}) as Partial<Bookmark>
  const id = String(x?.id || '')
  const url = String(x?.url || '')
  if (!id || !url) return null
  return {
    id,
    title: String(x.title || ''),
    url,
    iconUrl: typeof x.iconUrl === 'string' ? x.iconUrl : '',
    iconDataUrl: typeof x.iconDataUrl === 'string' ? x.iconDataUrl : '',
    iconPath: typeof x.iconPath === 'string' ? x.iconPath : '',
    createdAt: typeof x.createdAt === 'number' ? x.createdAt : Date.now(),
    updatedAt: typeof x.updatedAt === 'number' ? x.updatedAt : Date.now(),
  }
}

export default function BookmarksPage() {
  const [items, setItems] = useState<Bookmark[]>([])
  const [query, setQuery] = useState('')
  const [reorderMode, setReorderMode] = useState(false)
  const [dialog, setDialog] = useState<'add' | 'edit' | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [sniffingFormIcon, setSniffingFormIcon] = useState(false)
  const [iconCacheById, setIconCacheById] = useState<Record<string, string>>({})
  const [ctxMenu, setCtxMenu] = useState<CtxMenu>({ open: false, id: '', url: '', x: 0, y: 0 })
  const [confirmKey, setConfirmKey] = useState('')
  const [confirmUntil, setConfirmUntil] = useState(0)
  const [loading, setLoading] = useState(true)
  const [overId, setOverId] = useState('')
  const iconLoadingById = useRef<Set<string>>(new Set())
  const reorder = useRef<Reorder>({ pointerId: null, draggingId: '', overId: '', startX: 0, startY: 0, moved: false })
  const itemsRef = useRef<Bookmark[]>([])
  itemsRef.current = items

  const persist = useCallback((next: Bookmark[]) => {
    setItems(next)
    invoke('bookmarks_save', { items: next }).catch(err => console.warn('[webview] 保存书签失败:', err))
  }, [])

  useEffect(() => {
    void (async () => {
      const saved = await invoke<unknown[]>('bookmarks_load').catch(err => {
        console.warn('[webview] 加载书签失败:', err)
        return []
      })
      const normalized = (Array.isArray(saved) ? saved : []).map(normalizeBookmark).filter((x): x is Bookmark => x !== null)
      setItems(normalized)
      setLoading(false)
    })()
  }, [])

  const visibleItems = useMemo(() => {
    const q = String(query || '').trim().toLowerCase()
    if (!q) return items.slice()
    return items.filter(x => String(x.title || '').toLowerCase().includes(q) || String(x.url || '').toLowerCase().includes(q))
  }, [items, query])

  const ensureItemIconLoaded = useCallback(
    (item: Bookmark) => {
      const id = String(item?.id || '')
      if (!id) return
      if (iconCacheById[id]) return
      if (iconLoadingById.current.has(id)) return
      iconLoadingById.current.add(id)

      const applyLoadedIcon = (dataUrl: string) => {
        if (dataUrl) setIconCacheById(prev => ({ ...prev, [id]: dataUrl }))
      }

      const path = String(item.iconPath || '').trim()
      if (!path) {
        const legacy = String(item.iconDataUrl || '').trim()
        if (!legacy) {
          iconLoadingById.current.delete(id)
          return
        }
        Promise.resolve()
          .then(async () => {
            const png = await rasterizeToPngDataUrl(legacy, 64)
            const okLegacy =
              legacy.includes('data:image/png') || legacy.includes('data:image/jpeg') || legacy.includes('data:image/webp')
            const payload = png || (okLegacy ? legacy : '')
            if (!payload) return
            const savedPath = await saveIconPngToFile(payload)
            if (savedPath) {
              persist(itemsRef.current.map(x => (x.id === id ? { ...x, iconPath: savedPath, iconDataUrl: '' } : x)))
              const dataUrl = await invoke<string>('bookmark_icon_read', { path: savedPath }).catch(() => '')
              applyLoadedIcon(dataUrl)
            }
          })
          .catch(err => console.warn('[webview] 旧图标迁移失败:', err))
          .finally(() => {
            iconLoadingById.current.delete(id)
          })
        return
      }

      invoke<string>('bookmark_icon_read', { path })
        .then(applyLoadedIcon)
        .catch(() => {
          persist(itemsRef.current.map(x => (x.id === id ? { ...x, iconPath: '' } : x)))
        })
        .finally(() => {
          iconLoadingById.current.delete(id)
        })
    },
    [iconCacheById, persist],
  )

  const openInWindow = useCallback(async (url: string) => {
    const u = normalizeUrl(url)
    if (!u || !isHttpUrl(u)) {
      toast('URL 只支持 http(s)://，可省略协议')
      return
    }
    await invoke('open_browser_window', { url: u }).catch(err => {
      console.warn('[webview] 打开浏览器失败:', err)
      toast('打开失败')
    })
  }, [])

  const confirmOnce = useCallback(
    (key: string, message: string): boolean => {
      const now = Date.now()
      if (confirmKey === key && confirmUntil > now) {
        setConfirmKey('')
        setConfirmUntil(0)
        return true
      }
      setConfirmKey(key)
      setConfirmUntil(now + 2500)
      toast(message)
      return false
    },
    [confirmKey, confirmUntil],
  )

  const refreshIconForBookmark = useCallback(
    async (bookmark: Bookmark) => {
      const id = bookmark.id
      if (!id) return
      toast('正在嗅探图标...')
      const iconUrl = await sniffIconUrl(bookmark.url)
      if (!iconUrl) {
        toast('未找到图标')
        return
      }
      const dataUrl = await downloadIconDataUrl(iconUrl)
      if (!dataUrl) {
        persist(itemsRef.current.map(x => (x.id === id ? { ...x, iconUrl, updatedAt: Date.now() } : x)))
        toast('已设置图标地址（未下载）')
        return
      }
      const png = (await rasterizeToPngDataUrl(dataUrl, 64)) || null
      const oldPath = String(bookmark.iconPath || '').trim()
      if (!png) {
        toast('图标下载成功，但无法转换为 PNG')
        return
      }
      const path = await saveIconPngToFile(png)
      if (path) {
        if (oldPath) invoke('bookmark_icon_delete', { path: oldPath }).catch(err => console.warn('[webview] 删除旧图标失败:', err))
        persist(itemsRef.current.map(x => (x.id === id ? { ...x, iconPath: path, iconUrl, iconDataUrl: '', updatedAt: Date.now() } : x)))
        setIconCacheById(prev => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        toast('图标已下载到本地')
      } else {
        toast('图标保存失败')
      }
    },
    [persist],
  )

  const addItem = useCallback(async () => {
    const title = String(form.title || '').trim()
    const url = normalizeUrl(form.url)
    if (!url || !isHttpUrl(url)) {
      toast('URL 只支持 http(s)://，可省略协议')
      return
    }
    const now = Date.now()
    const iconUrl = String(form.iconUrl || '').trim()
    const iconDataUrl = String(form.iconDataUrl || '').trim()
    const itemId = uid()
    let iconPath = ''
    if (iconDataUrl) {
      const png = (await rasterizeToPngDataUrl(iconDataUrl, 64)) || iconDataUrl
      const savedPath = await saveIconPngToFile(png)
      if (savedPath) iconPath = savedPath
    }
    const bookmark: Bookmark = {
      id: itemId,
      title: title || url,
      url,
      iconUrl,
      iconDataUrl: '',
      iconPath,
      createdAt: now,
      updatedAt: now,
    }
    persist([bookmark, ...itemsRef.current])
    toast('已添加')
    setDialog(null)
    void openInWindow(url)

    if (!iconUrl && !iconPath) {
      void refreshIconForBookmark(bookmark).catch(() => {})
    }
  }, [form, persist, openInWindow, refreshIconForBookmark])

  const editItem = useCallback(async () => {
    const id = String(form.id || '')
    const current = itemsRef.current
    const idx = current.findIndex(x => x.id === id)
    if (idx < 0) return
    const title = String(form.title || '').trim()
    const url = normalizeUrl(form.url)
    if (!url || !isHttpUrl(url)) {
      toast('URL 只支持 http(s)://，可省略协议')
      return
    }
    const existing = current[idx]
    const iconUrl = String(form.iconUrl || '').trim()
    const iconDataUrl = String(form.iconDataUrl || '').trim()
    let iconPath = String(existing.iconPath || '').trim()

    if (form.iconCleared) {
      if (iconPath) invoke('bookmark_icon_delete', { path: iconPath }).catch(err => console.warn('[webview] 删除图标失败:', err))
      iconPath = ''
      setIconCacheById(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    } else if (iconDataUrl) {
      const png = (await rasterizeToPngDataUrl(iconDataUrl, 64)) || iconDataUrl
      const savedPath = await saveIconPngToFile(png)
      if (savedPath) {
        if (iconPath && iconPath !== savedPath) invoke('bookmark_icon_delete', { path: iconPath }).catch(err => console.warn('[webview] 删除旧图标失败:', err))
        iconPath = savedPath
        setIconCacheById(prev => {
          const next = { ...prev }
          delete next[id]
          return next
        })
      }
    }

    persist(
      current.map((x, i) =>
        i === idx
          ? {
              ...x,
              title: title || url,
              url,
              iconUrl: form.iconCleared ? '' : iconUrl,
              iconDataUrl: '',
              iconPath,
              updatedAt: Date.now(),
            }
          : x,
      ),
    )
    toast('已保存')
    setDialog(null)
  }, [form, persist])

  const deleteItem = useCallback(
    async (id: string) => {
      if (!confirmOnce(`del:${id}`, '再点一次删除')) return
      const current = itemsRef.current
      const existing = current.find(x => x.id === id)
      const next = current.filter(x => x.id !== id)
      if (next.length === current.length) return
      if (existing && String(existing.iconPath || '').trim()) {
        invoke('bookmark_icon_delete', { path: existing.iconPath }).catch(err => console.warn('[webview] 删除图标失败:', err))
      }
      setIconCacheById(prev => {
        const c = { ...prev }
        delete c[id]
        return c
      })
      persist(next)
      toast('已删除')
    },
    [confirmOnce, persist],
  )

  const sniffFormIcon = useCallback(async () => {
    if (sniffingFormIcon) return
    setSniffingFormIcon(true)
    toast('正在嗅探并下载图标...')
    try {
      const iconUrl = await sniffIconUrl(form.url)
      if (!iconUrl) {
        toast('未找到图标')
        return
      }
      setForm(prev => ({ ...prev, iconUrl, iconCleared: false }))
      const dataUrl = await downloadIconDataUrl(iconUrl)
      if (dataUrl) {
        const png = await rasterizeToPngDataUrl(dataUrl, 64)
        if (png) setForm(prev => ({ ...prev, iconUrl, iconDataUrl: png, iconCleared: false }))
      }
    } finally {
      setSniffingFormIcon(false)
    }
  }, [sniffingFormIcon, form.url])

  const openTypedUrl = () => {
    const u = normalizeUrl(query)
    if (!u || !isHttpUrl(u)) {
      toast('URL 只支持 http(s)://，可省略协议')
      return
    }
    void openInWindow(u)
  }

  const openModal = (kind: 'add' | 'edit', item?: Bookmark) => {
    setDialog(kind)
    setForm(
      kind === 'add' || !item
        ? emptyForm()
        : {
            id: String(item.id || ''),
            title: String(item.title || ''),
            url: String(item.url || ''),
            iconUrl: String(item.iconUrl || ''),
            iconDataUrl: '',
            iconCleared: false,
          },
    )
  }

  const ctxOpen = () => {
    const url = String(ctxMenu.url || '').trim()
    setCtxMenu(m => ({ ...m, open: false }))
    if (url) void openInWindow(url)
  }

  const ctxEdit = () => {
    const id = String(ctxMenu.id || '').trim()
    const item = itemsRef.current.find(x => x.id === id)
    setCtxMenu(m => ({ ...m, open: false }))
    if (item) openModal('edit', item)
  }

  const ctxSniff = () => {
    const id = String(ctxMenu.id || '').trim()
    const item = itemsRef.current.find(x => x.id === id)
    setCtxMenu(m => ({ ...m, open: false }))
    if (item) void refreshIconForBookmark(item)
  }

  const ctxDelete = () => {
    const id = String(ctxMenu.id || '').trim()
    setCtxMenu(m => ({ ...m, open: false }))
    if (id) void deleteItem(id)
  }

  // 拖拽排序：按住把手拖动到目标书签上松开完成排序
  useEffect(() => {
    if (!reorderMode) return

    const onPointerMove = (e: PointerEvent) => {
      const r = reorder.current
      if (!r.draggingId) return
      if (r.pointerId !== null && e.pointerId !== r.pointerId) return

      const dx = Math.abs(e.clientX - r.startX)
      const dy = Math.abs(e.clientY - r.startY)
      if (dx + dy > 4) r.moved = true

      const el = document.elementFromPoint(e.clientX, e.clientY)
      const tile = el?.closest?.('[data-bm-tile]')
      const id = tile?.getAttribute('data-id') || ''
      if (!id || id === r.draggingId) {
        r.overId = ''
        setOverId('')
        return
      }
      if (r.overId !== id) {
        r.overId = id
        setOverId(id)
      }
    }

    const finish = (commit: boolean) => {
      const r = reorder.current
      if (!r.draggingId) return
      const draggedId = r.draggingId
      const targetId = r.overId
      const moved = r.moved
      r.pointerId = null
      r.draggingId = ''
      r.overId = ''
      r.startX = 0
      r.startY = 0
      r.moved = false
      setOverId('')

      if (!commit || !moved || !targetId || targetId === draggedId) return
      const current = itemsRef.current
      const fromIndex = current.findIndex(x => x.id === draggedId)
      const toIndex = current.findIndex(x => x.id === targetId)
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
      const next = current.slice()
      const [it] = next.splice(fromIndex, 1)
      const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex
      next.splice(insertIndex, 0, it)
      persist(next)
    }

    const onPointerUp = (e: PointerEvent) => {
      const r = reorder.current
      if (r.pointerId !== null && e.pointerId !== r.pointerId) return
      finish(true)
    }
    const onPointerCancel = (e: PointerEvent) => {
      const r = reorder.current
      if (r.pointerId !== null && e.pointerId !== r.pointerId) return
      finish(false)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [reorderMode, persist])

  const onHandlePointerDown = (e: React.PointerEvent<HTMLButtonElement>, id: string) => {
    if (!reorderMode) return
    if (e.button !== 0) return
    if (String(query || '').trim()) return
    e.preventDefault()
    e.stopPropagation()
    const r = reorder.current
    r.pointerId = e.pointerId
    r.draggingId = id
    r.overId = ''
    r.startX = e.clientX
    r.startY = e.clientY
    r.moved = false
  }

  return (
    <div className="bm-wrap">
      <div className="bm-toolbar">
        <label className="bm-search">
          <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16">
            <path
              fill="currentColor"
              d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"
            />
          </svg>
          <input value={query} placeholder="输入网址直接打开，或搜索网站标题/网址" onChange={e => setQuery(e.target.value)} onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              openTypedUrl()
            }
          }} />
        </label>
        <button type="button" className="bm-tool-btn" onClick={openTypedUrl}>
          打开
        </button>
        <button
          type="button"
          className="bm-tool-btn"
          data-active={reorderMode ? '1' : undefined}
          onClick={() => {
            setReorderMode(v => {
              toast(v ? '已退出拖拽排序' : '已进入拖拽排序：拖动左上角把手')
              return !v
            })
          }}
          disabled={Boolean(String(query || '').trim())}
          title={String(query || '').trim() ? '搜索中不可排序' : '拖拽排序模式'}
        >
          ⠿ 拖拽排序
        </button>
        <button type="button" className="bm-tool-btn bm-tool-primary" onClick={() => openModal('add')}>
          ＋ 新增网站
        </button>
      </div>

      <div className="bm-content">
        <div className="bm-list">
          {loading ? (
            <div className="bm-empty">
              <div className="bm-empty-icon">🧭</div>
              <div className="bm-empty-title">正在加载收藏…</div>
            </div>
          ) : visibleItems.length === 0 ? (
            query ? (
              <div className="bm-empty">
                <div className="bm-empty-icon">🔍</div>
                <div className="bm-empty-title">没有找到匹配的网站</div>
                <div className="bm-empty-hint">换个关键词试试</div>
              </div>
            ) : (
              <div className="bm-empty">
                <div className="bm-empty-icon">🌐</div>
                <div className="bm-empty-title">还没有收藏任何网站</div>
                <div className="bm-empty-hint">点击右上角「新增网站」，收藏你常去的页面</div>
                <button type="button" className="bm-tool-btn bm-tool-primary" onClick={() => openModal('add')}>
                  ＋ 收藏第一个网站
                </button>
              </div>
            )
          ) : (
            visibleItems.map(x => {
              const icon = String(iconCacheById[x.id] || '').trim()
              if (!icon) ensureItemIconLoaded(x)
              return (
                <div
                  key={x.id}
                  data-bm-tile="true"
                  data-id={x.id}
                  data-over={overId === x.id ? '1' : undefined}
                  className="bm-tile"
                  role="button"
                  tabIndex={0}
                  title={x.url}
                  onClick={() => void openInWindow(x.url)}
                  onContextMenu={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    setCtxMenu({ open: true, id: x.id, url: x.url, x: e.clientX, y: e.clientY })
                  }}
                >
                  {reorderMode ? (
                    <button
                      type="button"
                      className="bm-drag-handle"
                      aria-label="拖拽排序"
                      title="拖拽排序"
                      tabIndex={-1}
                      onPointerDown={e => onHandlePointerDown(e, x.id)}
                    >
                      ⠿
                    </button>
                  ) : null}
                  <div className="bm-site-icon" aria-hidden="true">
                    {icon ? (
                      <img alt="网站图标" loading="lazy" referrerPolicy="no-referrer" src={icon} />
                    ) : (
                      <span className="bm-fallback">🌐</span>
                    )}
                  </div>
                  <div className="bm-tile-name">{x.title || x.url}</div>
                  <div className="bm-tile-url">{x.url.replace(/^https?:\/\//i, '').replace(/\/$/, '')}</div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {dialog === 'add' || dialog === 'edit' ? (
        <div className="bm-overlay" role="dialog" aria-modal="true" aria-label={dialog === 'add' ? '新增网站' : '编辑网站'}>
          <div className="bm-modal">
            <div className="bm-modal-head">
              <div className="bm-modal-title">{dialog === 'add' ? '新增网站' : '编辑网站'}</div>
              <button type="button" className="bm-tool-btn" onClick={() => setDialog(null)}>
                关闭
              </button>
            </div>
            <div className="bm-modal-body">
              <label className="bm-field">
                <span className="bm-label">标题（可选）</span>
                <input value={form.title} placeholder="例如：GitHub" onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
              </label>
              <label className="bm-field">
                <span className="bm-label">URL</span>
                <input value={form.url} placeholder="https://example.com（可省略协议）" onChange={e => setForm(p => ({ ...p, url: e.target.value }))} />
              </label>
              <div className="bm-row">
                <div className="bm-icon-line">
                  <div className="bm-site-icon bm-site-icon-sm">
                    {form.iconDataUrl || form.iconUrl ? (
                      <img alt="网站图标" referrerPolicy="no-referrer" src={form.iconDataUrl || form.iconUrl} />
                    ) : (
                      <span className="bm-fallback">🌐</span>
                    )}
                  </div>
                  <div className="bm-help">图标会嗅探并下载到本地（离线可用）</div>
                </div>
                <div className="bm-spacer" />
                <button type="button" className="bm-tool-btn" disabled={sniffingFormIcon} onClick={() => void sniffFormIcon()}>
                  {sniffingFormIcon ? '嗅探中…' : '嗅探并下载'}
                </button>
                <button type="button" className="bm-tool-btn" onClick={() => setForm(p => ({ ...p, iconUrl: '', iconDataUrl: '', iconCleared: true }))}>
                  清除
                </button>
              </div>
              <div className="bm-row">
                <div className="bm-hint">{dialog === 'add' ? '点击添加后会用新窗口打开' : '保存只更新列表，不会自动打开'}</div>
                <div className="bm-spacer" />
                <button type="button" className="bm-tool-btn" onClick={() => setDialog(null)}>
                  取消
                </button>
                <button type="button" className="bm-tool-btn bm-tool-primary" onClick={() => (dialog === 'add' ? void addItem() : void editItem())}>
                  {dialog === 'add' ? '添加' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {ctxMenu.open ? (
        <>
          <div className="bm-ctx-backdrop" onPointerDown={() => setCtxMenu(m => ({ ...m, open: false }))} />
          <div className="bm-ctx-menu" role="menu" aria-label="网站操作" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <button type="button" role="menuitem" onClick={() => ctxOpen()}>
              ↗ 打开
            </button>
            <button type="button" role="menuitem" onClick={() => ctxEdit()}>
              ✎ 编辑
            </button>
            <button type="button" role="menuitem" onClick={() => ctxSniff()}>
              ⟳ 刷新图标
            </button>
            <div className="bm-ctx-sep" role="separator" />
            <button type="button" role="menuitem" className="bm-ctx-danger" onClick={() => ctxDelete()}>
              🗑 删除
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
