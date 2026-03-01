// ai-chat (iframe sandbox) (entry: index.js)
import { now, uid, esc, trimSlash, isHttpBaseUrl, clampTemp, normImagePaths, clamp } from './core/utils'
import { extractOpenAiDelta, sseFeed } from './core/sse'
;(function () {
  const api = window.fastWindow
  const STORAGE_KEY = 'data'
  const BG_JOB_KEY_PREFIX = 'bg.job.'
  const BG_STREAM_KEY_PREFIX = 'bg.stream.'
  const VERSION = 2
  const runtime = String(api?.__meta?.runtime || 'ui')
  const MAX_DRAFT_IMAGES = 8
  const REF_IMG_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA='

  const uiRefImgCache = new Map()
  const uiRefImgPending = new Set()

  const state = {
    loading: true,
    sending: false,
    sendingJobId: '',
    modal: '',
    mermaid: { items: [], index: 0, scale: 1 },
    sideTab: 'roles', // roles | chats
    models: { loading: false, error: '', items: [] },
    draft: {
      input: '',
      images: [],
      activeRoleId: '',

      editRoleId: '',
      roleName: '',
      roleAvatar: '',
      roleSystemPrompt: '',
      roleProviderId: '',
      roleModelId: '',
      roleCustomModelId: '',
      roleTemperature: '0.7',

      editProviderId: '',
      providerName: '',
      providerBaseUrl: '',
      providerApiKey: '',

      deleteRoleId: '',
      deleteProviderId: '',
    },
    data: null,
  }

  let ver = 0
  const subs = new Set()
  function emit() {
    ver++
    for (const fn of Array.from(subs)) {
      try {
        fn()
      } catch (_) {}
    }
  }
  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {}
    subs.add(fn)
    return () => subs.delete(fn)
  }

  function defaultData() {
    const pid = uid('p')
    const rid = uid('r')
    const cid = uid('c')
    return {
      version: VERSION,
      settings: {
        streamEnabled: true,
        providers: [
          {
            id: pid,
            name: '默认供应商（OpenAI 兼容）',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: '',
            modelsCache: { items: [], fetchedAt: 0 },
          },
        ],
      },
      roles: [
        {
          id: rid,
          name: '默认角色',
          avatar: '🤖',
          systemPrompt: '你是一个严谨、简洁的助手。',
          temperature: 0.7,
          modelRef: { providerId: pid, modelId: '' },
          createdAt: now(),
          updatedAt: now(),
        },
      ],
      chatsByRole: {
        [rid]: {
          activeChatId: cid,
          chats: [{ id: cid, title: '新聊天', createdAt: now(), updatedAt: now(), messages: [] }],
        },
      },
      ui: { activeRoleId: rid },
    }
  }

  function normalizeData(raw) {
    const d0 = raw && typeof raw === 'object' ? raw : {}

    // v1 -> v2 迁移：原本每个角色只有一个 messages[]，升级为“多会话”
    if (d0.version === 1) {
      const out = {
        version: VERSION,
        settings: d0.settings && typeof d0.settings === 'object' ? d0.settings : {},
        roles: Array.isArray(d0.roles) ? d0.roles : [],
        chatsByRole: {},
        ui: d0.ui && typeof d0.ui === 'object' ? d0.ui : {},
      }

      const baseProviders = Array.isArray(out.settings?.providers) && out.settings.providers.length ? out.settings.providers : defaultData().settings.providers
      out.settings.providers = baseProviders

      const baseRoles = Array.isArray(out.roles) && out.roles.length ? out.roles : defaultData().roles
      out.roles = baseRoles

      const v1Chats = d0.chats && typeof d0.chats === 'object' ? d0.chats : {}

      for (const r of out.roles) {
        const rid = String(r?.id || uid('r'))
        const v1 = v1Chats[rid] && typeof v1Chats[rid] === 'object' ? v1Chats[rid] : { messages: [], updatedAt: 0 }
        const msgs = Array.isArray(v1.messages) ? v1.messages : []
        const createdAt = Number(msgs[0]?.createdAt || now())
        const updatedAt = Number(v1.updatedAt || createdAt || now())
        const cid = uid('c')
        out.chatsByRole[rid] = {
          activeChatId: cid,
          chats: [{ id: cid, title: '聊天 1', createdAt, updatedAt, messages: msgs }],
        }
      }

      // 接着走 v2 normalize
      return normalizeData(out)
    }

    if (d0.version !== VERSION) return defaultData()
    const d = d0

    if (!d.settings || typeof d.settings !== 'object') d.settings = {}
    if (typeof d.settings.streamEnabled !== 'boolean') d.settings.streamEnabled = true
    if (!Array.isArray(d.settings.providers) || d.settings.providers.length === 0) d.settings.providers = defaultData().settings.providers

    for (const p of d.settings.providers) {
      if (!p || typeof p !== 'object') continue
      if (!p.id) p.id = uid('p')
      if (typeof p.name !== 'string' || !p.name.trim()) p.name = '未命名供应商'
      if (typeof p.baseUrl !== 'string' || !p.baseUrl.trim()) p.baseUrl = 'http://'
      if (typeof p.apiKey !== 'string') p.apiKey = ''
      if (!p.modelsCache || typeof p.modelsCache !== 'object') p.modelsCache = { items: [], fetchedAt: 0 }
      if (!Array.isArray(p.modelsCache.items)) p.modelsCache.items = []
      p.modelsCache.fetchedAt = Number(p.modelsCache.fetchedAt || 0)
    }

    if (!Array.isArray(d.roles) || d.roles.length === 0) d.roles = defaultData().roles

    for (const r of d.roles) {
      if (!r || typeof r !== 'object') continue
      if (!r.id) r.id = uid('r')
      if (typeof r.name !== 'string' || !r.name.trim()) r.name = '未命名角色'
      if (typeof r.avatar !== 'string' || !r.avatar.trim()) r.avatar = '🙂'
      if (typeof r.systemPrompt !== 'string') r.systemPrompt = ''
      if (typeof r.temperature !== 'number' || !isFinite(r.temperature)) r.temperature = 0.7
      if (!r.modelRef || typeof r.modelRef !== 'object') r.modelRef = { providerId: String(d.settings.providers[0]?.id || ''), modelId: '' }
      if (typeof r.modelRef.providerId !== 'string') r.modelRef.providerId = String(d.settings.providers[0]?.id || '')
      if (typeof r.modelRef.modelId !== 'string') r.modelRef.modelId = ''
      r.createdAt = Number(r.createdAt || now())
      r.updatedAt = Number(r.updatedAt || now())
    }

    if (!d.chatsByRole || typeof d.chatsByRole !== 'object') d.chatsByRole = {}
    for (const r of d.roles) {
      const rid = String(r.id)
      if (!d.chatsByRole[rid] || typeof d.chatsByRole[rid] !== 'object') d.chatsByRole[rid] = { activeChatId: '', chats: [] }
      const box = d.chatsByRole[rid]
      if (!Array.isArray(box.chats)) box.chats = []
      box.activeChatId = String(box.activeChatId || '')

      box.chats = box.chats
        .filter((c) => c && typeof c === 'object')
        .map((c) => {
          const cc = c
          const cid = String(cc.id || uid('c'))
          const title = typeof cc.title === 'string' && cc.title.trim() ? cc.title : '新聊天'
          const createdAt = Number(cc.createdAt || now())
          const updatedAt = Number(cc.updatedAt || createdAt || now())
          const messages = Array.isArray(cc.messages) ? cc.messages : []
          return {
            id: cid,
            title,
            createdAt,
            updatedAt,
            messages: messages
              .filter((m) => m && typeof m === 'object')
                .map((m) => ({
                  id: String(m.id || uid('m')),
                  role: m.role === 'assistant' ? 'assistant' : 'user',
                  content: String(m.content || ''),
                  images: normImagePaths(m.images),
                  pending: !!m.pending,
                  streaming: !!m.streaming,
                  createdAt: Number(m.createdAt || now()),
                })),
            }
          })

      if (!box.chats.length) {
        const cid = uid('c')
        box.chats = [{ id: cid, title: '新聊天', createdAt: now(), updatedAt: now(), messages: [] }]
        box.activeChatId = cid
      }

      if (!box.activeChatId || !box.chats.some((c) => String(c.id) === box.activeChatId)) box.activeChatId = String(box.chats[0]?.id || '')
    }

    if (!d.ui || typeof d.ui !== 'object') d.ui = {}
    const activeRoleId = String(d.ui.activeRoleId || '')
    if (!activeRoleId || !d.roles.some((r) => String(r?.id) === activeRoleId)) d.ui.activeRoleId = String(d.roles[0]?.id || '')

    return d
  }

  if (runtime === 'background') {
    backgroundMain().catch(() => {})
    return
  }

  async function load() {
    try {
      const raw = await api.storage.get(STORAGE_KEY)
      state.data = normalizeData(raw)
      state.draft.activeRoleId = String(state.data.ui.activeRoleId || '')
    } catch (_) {
      state.data = defaultData()
      state.draft.activeRoleId = String(state.data.ui.activeRoleId || '')
      try {
        await save()
      } catch (_) {}
    } finally {
      state.loading = false
    }
  }

  async function save() {
    if (!state.data) return
    state.data.ui.activeRoleId = String(state.draft.activeRoleId || '')
    await api.storage.set(STORAGE_KEY, state.data)
  }

  function getProvider(pid) {
    const ps = state.data?.settings?.providers
    if (!Array.isArray(ps)) return null
    return ps.find((p) => String(p?.id) === String(pid)) || null
  }

  function activeRole() {
    const rid = String(state.draft.activeRoleId || state.data?.ui?.activeRoleId || '')
    return state.data?.roles?.find((r) => String(r?.id) === rid) || null
  }

  function activeChat() {
    const r = activeRole()
    if (!r || !state.data) return null
    const box = state.data.chatsByRole?.[String(r.id)]
    if (!box) return null
    const activeChatId = String(box.activeChatId || '')
    const chats = Array.isArray(box.chats) ? box.chats : []
    return chats.find((c) => String(c?.id) === activeChatId) || chats[0] || null
  }

  function ensureRoleDefaults(role) {
    if (!state.data) return
    const fallbackPid = String(state.data.settings.providers?.[0]?.id || '')
    if (!role.modelRef || typeof role.modelRef !== 'object') role.modelRef = { providerId: fallbackPid, modelId: '' }
    if (!role.modelRef.providerId) role.modelRef.providerId = fallbackPid
    if (typeof role.modelRef.modelId !== 'string') role.modelRef.modelId = ''
  }

  function loadScriptOnce(url, globalName) {
    return new Promise((resolve, reject) => {
      if (globalName && window[globalName]) return resolve(true)
      const s = document.createElement('script')
      s.src = url
      s.async = true
      s.onload = () => resolve(true)
      s.onerror = () => reject(new Error(`加载失败：${url}`))
      document.head.appendChild(s)
    })
  }

  function loadCssOnce(url, id) {
    if (id && document.getElementById(id)) return
    const link = document.createElement('link')
    if (id) link.id = id
    link.rel = 'stylesheet'
    link.href = url
    document.head.appendChild(link)
  }

  let rendererPromise = null
  let domPurifyHooked = false
  let mermaidInited = false
  function initMermaidOnce() {
    const m = window.mermaid
    if (mermaidInited || !m || !m.initialize) return
    try {
      mermaidInited = true
      m.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'default',
        themeVariables: {
          fontFamily:
            'system-ui,-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC","Noto Sans CJK SC",Roboto,Arial,sans-serif',
        },
        flowchart: { htmlLabels: false },
        state: { htmlLabels: false },
        class: { htmlLabels: false },
      })
    } catch (_) {}
  }
  function ensureRenderer() {
    if (rendererPromise) return rendererPromise
    rendererPromise = (async () => {
      // v2: 依赖在构建期打包为本地依赖（见 src/render/vendor.ts），运行时不再拉公共 CDN。
      try { initMermaidOnce() } catch (_) {}
    })()
    return rendererPromise
  }

  function sanitizeHtml(html) {
    const raw = String(html || '')

    function isSafeHref(href) {
      const s = String(href || '').trim().toLowerCase()
      return s.startsWith('http://') || s.startsWith('https://') || s.startsWith('mailto:')
    }

    function isAllowedAttr(tag, name) {
      const n = String(name || '').toLowerCase()
      const t = String(tag || '').toUpperCase()

      if (!n) return false
      if (n.startsWith('on')) return false
      if (n === 'id') return true
      if (n === 'class' || n === 'style') return true
      if (n.startsWith('data-')) return true
      if (n.startsWith('aria-') || n === 'role' || n === 'tabindex') return true

      if (t === 'A') return n === 'href' || n === 'target' || n === 'rel' || n === 'title'
      if (t === 'BUTTON') return n === 'type' || n === 'disabled' || n === 'title'
      if (t === 'INPUT') return n === 'type' || n === 'value' || n === 'checked' || n === 'disabled' || n === 'placeholder' || n === 'title'
      if (t === 'TD' || t === 'TH') return n === 'colspan' || n === 'rowspan' || n === 'title'
      if (t === 'DETAILS') return n === 'open'
      return false
    }

    function sanitizeStyleValue(style) {
      const s = String(style || '')
      if (!s.trim()) return ''
      const out = []
      const parts = s.split(';')
      for (const part of parts) {
        const p = part.trim()
        if (!p) continue
        const idx = p.indexOf(':')
        if (idx <= 0) continue
        const key = p.slice(0, idx).trim().toLowerCase()
        let value = p.slice(idx + 1).trim()
        if (!key || !value) continue

        const v = value.toLowerCase()
        if (v.includes('expression(') || v.includes('javascript:') || v.includes('@import') || v.includes('url(')) continue
        if (value.includes('<') || value.includes('>')) continue
        out.push(`${key}:${value}`)
      }
      return out.join(';')
    }

    if (window.DOMPurify && window.DOMPurify.sanitize) {
      try {
        if (!domPurifyHooked && window.DOMPurify.addHook) {
          domPurifyHooked = true
          window.DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
            try {
              const name = String(data?.attrName || '').toLowerCase()
              if (name.startsWith('on')) data.keepAttr = false
              if (name === 'href' && data.attrValue && !isSafeHref(data.attrValue)) data.keepAttr = false
              if (name === 'style') {
                const v = sanitizeStyleValue(String(data.attrValue || ''))
                if (!v) data.keepAttr = false
                else data.attrValue = v
              }
            } catch (_) {}
          })
        }

        return window.DOMPurify.sanitize(raw, {
          FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
          ALLOW_DATA_ATTR: true,
          ADD_TAGS: ['button', 'details', 'summary', 'input', 'label', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
          ADD_ATTR: ['id', 'style', 'class', 'role', 'tabindex', 'colspan', 'rowspan'],
        })
      } catch (_) {}
    }

    const tpl = document.createElement('template')
    tpl.innerHTML = raw

    const allowedTags = new Set([
      'DIV',
      'SPAN',
      'P',
      'BR',
      'PRE',
      'CODE',
      'EM',
      'STRONG',
      'UL',
      'OL',
      'LI',
      'BLOCKQUOTE',
      'A',
      'BUTTON',
      'DETAILS',
      'SUMMARY',
      'INPUT',
      'LABEL',
      'TABLE',
      'THEAD',
      'TBODY',
      'TR',
      'TH',
      'TD',
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
      'HR',
    ])

    const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT, null)
    const toRemove = []

    while (walker.nextNode()) {
      const node = walker.currentNode
      if (node.nodeType === Node.COMMENT_NODE) {
        toRemove.push(node)
        continue
      }

      const el = node
      const tag = String(el.tagName || '')
      if (!allowedTags.has(tag)) {
        el.replaceWith(document.createTextNode(el.textContent || ''))
        continue
      }

      const attrs = Array.from(el.attributes || [])
      for (const a of attrs) {
        const name = String(a.name || '').toLowerCase()
        if (!isAllowedAttr(tag, name)) {
          el.removeAttribute(a.name)
          continue
        }
        if (name === 'style') {
          const v = sanitizeStyleValue(el.getAttribute('style') || '')
          if (!v) el.removeAttribute('style')
          else el.setAttribute('style', v)
        }
      }

      if (tag === 'A') {
        const href = el.getAttribute('href') || ''
        if (href && !isSafeHref(href)) el.removeAttribute('href')
        const target = String(el.getAttribute('target') || '').toLowerCase()
        if (target && target !== '_blank') el.removeAttribute('target')
        if (target === '_blank') el.setAttribute('rel', 'noopener noreferrer')
      }
    }

    for (const n of toRemove) n.remove()
    return tpl.innerHTML
  }

  function preprocessMathBlocks(source) {
    const blocks = []
    const src = String(source || '').replace(/\r\n/g, '\n')

    function stash(tex) {
      const id = blocks.length
      blocks.push(String(tex || ''))
      return `@@BLOCK_MATH_${id}@@`
    }

    function replaceInText(text) {
      let s = String(text || '')
      s = s.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_, tex) => stash(tex))
      s = s.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_, tex) => stash(tex))
      return s
    }

    const fenceRe = /```[\s\S]*?```/g
    let out = ''
    let last = 0
    let m
    while ((m = fenceRe.exec(src))) {
      out += replaceInText(src.slice(last, m.index))
      out += m[0]
      last = m.index + m[0].length
    }
    out += replaceInText(src.slice(last))

    return { text: out, blocks }
  }

  function preprocessHtmlIndentation(source) {
    const src = String(source || '').replace(/\r\n/g, '\n')
    const fenceRe = /```[\s\S]*?```/g

    function dedentHtmlLines(s) {
      const t = String(s || '')
      // Markdown：4 空格缩进会被当作代码块；HTML 内部常见缩进会触发这个坑。
      // 仅在“非代码围栏”区域，把以 4 空格/Tab 开头且后面紧跟 < 或 <!-- 的行去掉缩进。
      return t
        .replace(/^(?:\t| {4})+(?=<)/gm, '')
        .replace(/^(?:\t| {4})+(?=<!--)/gm, '')
    }

    let out = ''
    let last = 0
    let m
    while ((m = fenceRe.exec(src))) {
      out += dedentHtmlLines(src.slice(last, m.index))
      out += m[0]
      last = m.index + m[0].length
    }
    out += dedentHtmlLines(src.slice(last))
    return out
  }

  function sanitizeSvg(svg) {
    const raw = String(svg || '')
    if (!raw) return ''
    if (window.DOMPurify && window.DOMPurify.sanitize) {
      try {
        return window.DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true } })
      } catch (_) {}
    }
    return raw
  }

  function mermaidItemsFromDom() {
    const chat = document.querySelector('[data-area="chat"]')
    const list = Array.from(chat?.querySelectorAll?.('.mermaid-block[data-mermaid="1"]') || [])
    const items = []
    for (const b of list) {
      if (!(b instanceof HTMLElement)) continue
      const svgEl = b.querySelector('svg')
      if (svgEl) items.push({ svg: sanitizeSvg(svgEl.outerHTML || '') })
      else items.push({ svg: sanitizeHtml(b.innerHTML || '') })
    }
    return { blocks: list, items }
  }

  function mermaidModalEls() {
    const root = document.querySelector('[data-mm-modal="1"]')
    if (!(root instanceof HTMLElement)) return null
    const stage = root.querySelector('[data-mm-stage="1"]')
    const canvas = root.querySelector('[data-mm-canvas="1"]')
    const label = root.querySelector('[data-mm-label="1"]')
    const zoom = root.querySelector('[data-mm-zoom="1"]')
    const prev = root.querySelector('[data-act="mm-prev"]')
    const next = root.querySelector('[data-act="mm-next"]')
    return {
      root,
      stage: stage instanceof HTMLElement ? stage : null,
      canvas: canvas instanceof HTMLElement ? canvas : null,
      label: label instanceof HTMLElement ? label : null,
      zoom: zoom instanceof HTMLElement ? zoom : null,
      prev: prev instanceof HTMLButtonElement ? prev : null,
      next: next instanceof HTMLButtonElement ? next : null,
    }
  }

  function applyMermaidScaleDom() {
    if (state.modal !== 'mermaid') return
    const els = mermaidModalEls()
    if (!els?.canvas) return
    const scale = clamp(state.mermaid.scale, 0.2, 6)
    state.mermaid.scale = scale
    els.canvas.style.transform = `scale(${scale})`
    if (els.zoom) els.zoom.textContent = `${Math.round(scale * 100)}%`
  }

  function renderMermaidModalDom(resetScroll) {
    if (state.modal !== 'mermaid') return
    const els = mermaidModalEls()
    if (!els?.canvas) return
    const len = Array.isArray(state.mermaid.items) ? state.mermaid.items.length : 0
    if (!len) return

    const idx = clamp(state.mermaid.index, 0, len - 1)
    state.mermaid.index = idx

    const svg = String(state.mermaid.items[idx]?.svg || '')
    els.canvas.innerHTML = svg || `<div class="muted">空图</div>`
    if (els.label) els.label.textContent = `${idx + 1}/${len}`
    if (els.prev) els.prev.disabled = len <= 1
    if (els.next) els.next.disabled = len <= 1

    if (resetScroll && els.stage) {
      els.stage.scrollTop = 0
      els.stage.scrollLeft = 0
    }

    applyMermaidScaleDom()
  }

  function openMermaidViewer(blockEl) {
    const srcEl = blockEl instanceof Element ? blockEl : null
    const r = mermaidItemsFromDom()
    if (!r.items.length) return

    let idx = 0
    if (srcEl) {
      const i = r.blocks.findIndex((b) => b === srcEl || (b instanceof HTMLElement && b.contains(srcEl)))
      if (i >= 0) idx = i
    }

    state.mermaid.items = r.items
    state.mermaid.index = idx
    state.mermaid.scale = 1
    state.modal = 'mermaid'
    renderModal()
    renderMermaidModalDom(true)
  }

  let mermaidDrag = null
  function cancelMermaidDrag() {
    const d = mermaidDrag
    if (!d) return
    mermaidDrag = null
    try {
      d.stage?.removeAttribute?.('data-mm-drag')
    } catch (_) {}
    try {
      window.removeEventListener('mousemove', onMouseMoveMermaid)
      window.removeEventListener('mouseup', onMouseUpMermaid)
      window.removeEventListener('blur', onMouseUpMermaid)
    } catch (_) {}
  }

  function onMouseMoveMermaid(e) {
    const d = mermaidDrag
    if (!d) return
    e.preventDefault()
    const dx = Number(e.clientX || 0) - d.x
    const dy = Number(e.clientY || 0) - d.y
    d.stage.scrollLeft = d.sl - dx
    d.stage.scrollTop = d.st - dy
  }

  function onMouseUpMermaid(_e) {
    if (!mermaidDrag) return
    cancelMermaidDrag()
  }

  async function renderMermaidInto(el) {
    if (!(el instanceof HTMLElement)) return
    const m = window.mermaid
    if (!m || !m.render) return

    const codes = Array.from(el.querySelectorAll?.('pre>code') || []).filter((c) => {
      if (!(c instanceof HTMLElement)) return false
      const cls = String(c.className || '')
      return cls.includes('language-mermaid') || cls.includes('lang-mermaid') || cls.includes('mermaid')
    })
    if (!codes.length) return

    initMermaidOnce()

    async function doRender(id, code, container) {
      try {
        return await m.render(id, code)
      } catch (_) {
        return await m.render(id, code, container)
      }
    }

    for (const codeEl of codes) {
      const pre = codeEl.closest('pre')
      if (!(pre instanceof HTMLElement)) continue
      if (pre.getAttribute('data-mermaid') === '1') continue

      const src = String(codeEl.textContent || '').trim()
      pre.setAttribute('data-mermaid', '1')
      if (!src) continue

      const holder = document.createElement('div')
      holder.className = 'mermaid-block'
      holder.setAttribute('data-mermaid', '1')
      holder.setAttribute('data-act', 'open-mermaid')
      pre.replaceWith(holder)

      try {
        const id = uid('mm')
        const r = await doRender(id, src, holder)
        const svg = typeof r === 'string' ? r : String(r?.svg || '')
        const safe = sanitizeSvg(svg)
        if (!safe) throw new Error('empty svg')
        holder.innerHTML = safe
        if (r && typeof r.bindFunctions === 'function') {
          try {
            r.bindFunctions(holder)
          } catch (_) {}
        }
      } catch (_) {
        holder.innerHTML = `<pre><code class="language-mermaid">${esc(src)}</code></pre>`
      }
    }
  }

  function renderAssistantInto(el, text) {
    const raw = String(text || '')
    let html = ''

    const noIndent = preprocessHtmlIndentation(raw)
    const pre = preprocessMathBlocks(noIndent)

    if (window.marked && window.marked.parse) {
      try {
        window.marked.setOptions?.({ gfm: true, breaks: true })
        html = window.marked.parse(pre.text)
      } catch (_) {
        html = `<pre>${esc(pre.text)}</pre>`
      }
    } else {
      html = `<pre>${esc(pre.text)}</pre>`
    }

    let safe = sanitizeHtml(html)
    if (Array.isArray(pre.blocks) && pre.blocks.length) {
      safe = safe.replace(/@@BLOCK_MATH_(\d+)@@/g, (_, id) => {
        const tex = pre.blocks[Number(id)] ?? ''
        return `<div class="math-block" data-tex="${esc(tex)}"></div>`
      })
    }

    el.innerHTML = safe

    // 块级公式：优先用 katex.render（避免 $$ 换行/BR 导致 auto-render 识别失败）
    const blocks = Array.from(el.querySelectorAll?.('.math-block[data-tex]') || [])
    if (blocks.length && window.katex && window.katex.render) {
      for (const b of blocks) {
        if (!(b instanceof HTMLElement)) continue
        if (b.getAttribute('data-rendered') === '1') continue
        const tex = b.getAttribute('data-tex') || ''
        try {
          window.katex.render(tex, b, { displayMode: true, throwOnError: false })
          b.setAttribute('data-rendered', '1')
        } catch (_) {}
      }
    }

    if (window.renderMathInElement) {
      try {
        window.renderMathInElement(el, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '\\[', right: '\\]', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false },
          ],
          throwOnError: false,
        })
      } catch (_) {}
    }

    renderMermaidInto(el).catch(() => {})
  }

  async function refreshModels(providerId, force) {
    const p = getProvider(providerId)
    if (!p) return

    const baseUrl = trimSlash(p.baseUrl || '')
    const apiKey = String(p.apiKey || '').trim()

    if (!baseUrl || !isHttpBaseUrl(baseUrl)) {
      state.models = { loading: false, error: '请先配置 Base URL（http/https）', items: [] }
      render()
      return
    }
    if (!apiKey) {
      state.models = { loading: false, error: '请先配置 API Key', items: [] }
      render()
      return
    }

    const cache = p.modelsCache || { items: [], fetchedAt: 0 }
    const age = now() - Number(cache.fetchedAt || 0)
    if (!force && Array.isArray(cache.items) && cache.items.length && age < 5 * 60 * 1000) {
      state.models = { loading: false, error: '', items: cache.items.slice(0, 300) }
      render()
      return
    }

    state.models = { loading: true, error: '', items: [] }
    render()

    try {
      const r = await api.net.request({
        method: 'GET',
        url: `${baseUrl}/models`,
        headers: { Authorization: `Bearer ${apiKey}` },
        timeoutMs: 20000,
      })

      const status = Number(r?.status || 0)
      const bodyText = String(r?.body || '')
      const json = JSON.parse(bodyText || '{}')
      if (status < 200 || status >= 300) throw new Error(json?.error?.message || bodyText || `HTTP ${status}`)

      const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : null
      if (!list) throw new Error('models 响应格式不支持（期望 data[] 或 models[]）')

      const ids = list
        .map((m) => (m && typeof m.id === 'string' ? m.id : ''))
        .filter((x) => !!x)
        .slice(0, 800)
        .sort((a, b) => String(a).localeCompare(String(b)))

      p.modelsCache = { items: ids, fetchedAt: now() }
      await save()

      state.models = { loading: false, error: '', items: ids.slice(0, 300) }
      api.ui?.showToast?.(`模型已刷新（${ids.length}）`)
    } catch (e) {
      state.models = { loading: false, error: String(e?.message || e || '获取模型失败'), items: [] }
      api.ui?.showToast?.(state.models.error || '获取模型失败')
    } finally {
      render()
    }
  }

  function limitHistory(messages, maxTurns) {
    const list = Array.isArray(messages) ? messages : []
    const ua = list.filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    return ua.slice(Math.max(0, ua.length - maxTurns))
  }

  function jobKey(jobId) {
    return `${BG_JOB_KEY_PREFIX}${String(jobId || '')}`
  }

  function streamKey(mid) {
    return `${BG_STREAM_KEY_PREFIX}${String(mid || '')}`
  }

  function looksLikeImageDataUrl(s) {
    const t = String(s || '')
    return t.startsWith('data:image/')
  }

  function addDraftImage(name, dataUrl) {
    if (!looksLikeImageDataUrl(dataUrl)) return false
    if (!Array.isArray(state.draft.images)) state.draft.images = []
    if (state.draft.images.length >= MAX_DRAFT_IMAGES) return false
    state.draft.images.push({ id: uid('img'), name: String(name || '图片'), dataUrl: String(dataUrl || '') })
    return true
  }

  function removeDraftImage(id) {
    const rid = String(id || '')
    if (!rid) return
    if (!Array.isArray(state.draft.images)) state.draft.images = []
    state.draft.images = state.draft.images.filter((x) => String(x?.id || '') !== rid)
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!(file instanceof File)) return reject(new Error('file 无效'))
      const r = new FileReader()
      r.onload = () => resolve(String(r.result || ''))
      r.onerror = () => reject(new Error('读取图片失败'))
      r.readAsDataURL(file)
    })
  }

  async function pickImages() {
    if (state.loading || state.sending) return
    if (typeof api?.files?.pickImages !== 'function') return api.ui?.showToast?.('未授权：files.pickImages')

    const left = Math.max(0, MAX_DRAFT_IMAGES - (Array.isArray(state.draft.images) ? state.draft.images.length : 0))
    if (!left) return api.ui?.showToast?.(`最多选择 ${MAX_DRAFT_IMAGES} 张图片`)

    try {
      const items = await api.files.pickImages(left)
      const list = Array.isArray(items) ? items : []
      let added = 0
      for (const it of list) {
        const name = String(it?.name || '图片')
        const dataUrl = String(it?.dataUrl || '')
        if (addDraftImage(name, dataUrl)) added++
      }
      if (!added) api.ui?.showToast?.('未选择图片')
    } catch (e) {
      api.ui?.showToast?.(String(e?.message || e || '选择图片失败'))
    } finally {
      renderComposer()
    }
  }

  async function sendChat() {
    if (state.sending || state.loading || !state.data) return

    const role = activeRole()
    const chat = activeChat()
    if (!role || !chat) return
    ensureRoleDefaults(role)

    const input = String(state.draft.input || '').trim()
    const draftImages = Array.isArray(state.draft.images) ? state.draft.images : []
    if (!input && !draftImages.length) return api.ui?.showToast?.('输入不能为空')

    const providerId = String(role.modelRef?.providerId || '')
    const modelId = String(role.modelRef?.modelId || '').trim()
    const p = getProvider(providerId)
    if (!p) return api.ui?.showToast?.('未找到该供应商')

    const baseUrl = trimSlash(p.baseUrl || '')
    const apiKey = String(p.apiKey || '').trim()

    if (!isHttpBaseUrl(baseUrl)) return api.ui?.showToast?.('请在供应商设置里配置 Base URL（http/https）')
    if (!apiKey) return api.ui?.showToast?.('请在供应商设置里配置 API Key')
    if (!modelId) return api.ui?.showToast?.('请在角色设置里选择模型（供应商 + 模型ID）')

    let assistantMid = ''
    try {
      if (draftImages.length && typeof api?.files?.saveRefImageBase64 !== 'function') {
        return api.ui?.showToast?.('未授权：files.saveRefImageBase64')
      }

      state.sending = true
      renderComposer()

      const savedPaths = []
      for (const img of draftImages.slice(0, MAX_DRAFT_IMAGES)) {
        const dataUrl = String(img?.dataUrl || '')
        if (!looksLikeImageDataUrl(dataUrl)) continue
        const saved = await api.files.saveRefImageBase64(dataUrl)
        const path = String(saved || '').trim()
        if (path) savedPaths.push(path)
      }

      const streamEnabled = !!state.data?.settings?.streamEnabled
      assistantMid = uid('m')

      const wasEmpty = !Array.isArray(chat.messages) || chat.messages.length === 0
      chat.messages.push({ id: uid('m'), role: 'user', content: input, images: savedPaths, createdAt: now() })
      chat.updatedAt = now()
      if (wasEmpty && String(chat.title || '') === '新聊天') {
        const t = input.replace(/\s+/g, ' ').trim()
        const base = t || (savedPaths.length ? '图片' : '新聊天')
        chat.title = base.length > 16 ? base.slice(0, 16) + '…' : base || '新聊天'
      }

      state.draft.input = ''
      state.draft.images = []

      chat.messages.push({
        id: assistantMid,
        role: 'assistant',
        content: '（生成中…）',
        pending: true,
        streaming: streamEnabled,
        createdAt: now(),
      })
      chat.updatedAt = now()

      const jobId = uid('job')
      const job = {
        id: jobId,
        kind: 'openai.chat.completions',
        status: 'queued',
        createdAt: now(),
        roleId: String(role.id || ''),
        chatId: String(chat.id || ''),
        assistantMid,
        stream: streamEnabled,
      }

      await save()
      await api.storage.set(jobKey(jobId), job)
      state.sendingJobId = jobId
    } catch (e) {
      const msg = String(e?.message || e || '请求失败')
      const items = Array.isArray(chat.messages) ? chat.messages : []
      const am = assistantMid ? items.find((m) => String(m?.id || '') === assistantMid) : null
      if (am) {
        am.content = `（请求失败：${msg}）`
        am.pending = false
        am.streaming = false
      }
      save().catch(() => {})

      state.sending = false
      state.sendingJobId = ''
      api.ui?.showToast?.(msg)
    } finally {
      render()
    }
  }


  async function patchAssistantMessage(job, content) {
    const roleId = String(job?.roleId || '')
    const chatId = String(job?.chatId || '')
    const mid = String(job?.assistantMid || '')
    if (!roleId || !chatId || !mid) return

    const raw = await api.storage.get(STORAGE_KEY)
    const d = normalizeData(raw)
    const box = d?.chatsByRole?.[roleId]
    const chats = Array.isArray(box?.chats) ? box.chats : []
    const chat = chats.find((c) => String(c?.id) === chatId)
    if (!chat) return

    const msgs = Array.isArray(chat.messages) ? chat.messages : []
    const m = msgs.find((x) => String(x?.id) === mid)
    if (!m) return

    m.content = String(content || '')
    m.pending = false
    m.streaming = false
    chat.updatedAt = now()

    await api.storage.set(STORAGE_KEY, d)
  }

  async function backgroundMain() {
    let running = false

    const tick = async () => {
      if (running) return
      running = true
      try {
        const all = await api.storage.getAll()
        const entries = all && typeof all === 'object' ? Object.entries(all) : []
        const jobs = []

        for (const [k, v] of entries) {
          if (!String(k || '').startsWith(BG_JOB_KEY_PREFIX)) continue
          const job = v && typeof v === 'object' ? v : null
          if (!job) continue
          if (String(job.status || '') !== 'queued') continue
          jobs.push(job)
        }

        jobs.sort((a, b) => Number(a?.createdAt || 0) - Number(b?.createdAt || 0))
        const job = jobs[0]
        if (!job) return

        job.status = 'running'
        job.startedAt = now()
        await api.storage.set(jobKey(job.id), job)

        await runBackgroundJob(job)
      } catch (_) {
      } finally {
        running = false
      }
    }

    await tick()
    setInterval(() => {
      tick().catch(() => {})
    }, 800)
  }

  async function buildOpenAiChatReqFromStorage(job) {
    const roleId = String(job?.roleId || '')
    const chatId = String(job?.chatId || '')
    if (!roleId || !chatId) throw new Error('job 缺少 roleId/chatId')

    const raw = await api.storage.get(STORAGE_KEY)
    const d = normalizeData(raw)

    const role = Array.isArray(d?.roles) ? d.roles.find((r) => String(r?.id || '') === roleId) : null
    if (!role) throw new Error('角色不存在')
    const fallbackPid = String(d?.settings?.providers?.[0]?.id || '')
    if (!role.modelRef || typeof role.modelRef !== 'object') role.modelRef = { providerId: fallbackPid, modelId: '' }
    if (!role.modelRef.providerId) role.modelRef.providerId = fallbackPid
    if (typeof role.modelRef.modelId !== 'string') role.modelRef.modelId = ''

    const providerId = String(role.modelRef?.providerId || '')
    const modelId = String(role.modelRef?.modelId || '').trim()
    const p = (Array.isArray(d?.settings?.providers) ? d.settings.providers : []).find((x) => String(x?.id || '') === providerId) || null
    if (!p) throw new Error('供应商不存在')

    const baseUrl = trimSlash(p.baseUrl || '')
    const apiKey = String(p.apiKey || '').trim()
    if (!isHttpBaseUrl(baseUrl)) throw new Error('Base URL 无效（需 http/https）')
    if (!apiKey) throw new Error('API Key 为空')
    if (!modelId) throw new Error('模型ID 为空')

    const box = d?.chatsByRole?.[roleId]
    const chats = Array.isArray(box?.chats) ? box.chats : []
    const chat = chats.find((c) => String(c?.id || '') === chatId) || null
    if (!chat) throw new Error('会话不存在')

    const msgs0 = Array.isArray(chat.messages) ? chat.messages : []
    const msgs = msgs0.filter((m) => !(m && m.role === 'assistant' && m.pending))
    const history = limitHistory(msgs, 40)

    const sys = String(role.systemPrompt || '').trim()
    const messages = []
    if (sys) messages.push({ role: 'system', content: sys })

    for (const m of history) {
      const r = m?.role === 'assistant' ? 'assistant' : 'user'
      const text = String(m?.content || '')
      if (r === 'user') {
        const paths = normImagePaths(m?.images)
        if (paths.length) {
          if (typeof api?.files?.readRefImage !== 'function') throw new Error('未授权：files.readRefImage')
          const parts = [{ type: 'text', text }]
          for (const path of paths) {
            let dataUrl = ''
            try {
              dataUrl = await api.files.readRefImage(path)
            } catch (e) {
              throw new Error(`读取图片失败：${String(e?.message || e || 'unknown')}`)
            }
            if (!looksLikeImageDataUrl(dataUrl)) throw new Error('读取图片失败：格式不支持')
            parts.push({ type: 'image_url', image_url: { url: dataUrl } })
          }
          messages.push({ role: 'user', content: parts })
          continue
        }
      }
      messages.push({ role: r, content: text })
    }

    const stream = !!job?.stream
    return {
      method: 'POST',
      url: `${baseUrl}/chat/completions`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelId, messages, temperature: clampTemp(role.temperature), stream }),
      timeoutMs: stream ? 15 * 60 * 1000 : 120000,
    }
  }

  async function runBackgroundJob(job) {
    const streamWanted = !!job?.stream
    let req = job?.req || null
    const mid = String(job?.assistantMid || '')
    if (!req || typeof req !== 'object') {
      if (String(job?.kind || '') === 'openai.chat.completions') {
        req = await buildOpenAiChatReqFromStorage(job)
      }
    }
    if (!req || typeof req !== 'object') throw new Error('job.req 无效')

    let out = ''
    let status = 0
    let bad = false
    let badBody = ''
    let lastFlush = 0

    const flush = async (force) => {
      if (!mid) return
      const t = now()
      if (!force && t - lastFlush < 220) return
      lastFlush = t
      await api.storage.set(streamKey(mid), { text: out, updatedAt: t })
    }

    try {
      const canStream = streamWanted && typeof api?.net?.requestStream === 'function'
      if (canStream) {
        const stream = await api.net.requestStream(req)
        const sse = { buf: '', done: false }

        for await (const ev of stream) {
          const t = String(ev?.type || '')
          if (t === 'start') {
            status = Number(ev?.status || 0)
            bad = status < 200 || status >= 300
            continue
          }
          if (t === 'chunk') {
            const text = String(ev?.text || '')
            if (!text) continue
            if (bad) {
              badBody += text
              continue
            }

            sseFeed(sse, text, (json) => {
              if (json?.error?.message) throw new Error(String(json.error.message))
              const delta = extractOpenAiDelta(json)
              if (typeof delta === 'string' && delta) out += delta
            })

            await flush(false)
            if (sse.done) break
            continue
          }
          if (t === 'error') throw new Error(String(ev?.message || '请求失败'))
          if (t === 'end') break
        }

        if (bad) {
          let msg = String(badBody || '').trim()
          try {
            const j = JSON.parse(msg || '{}')
            msg = String(j?.error?.message || msg || `HTTP ${status}`)
          } catch (_) {}
          throw new Error(msg || `HTTP ${status}`)
        }
      } else {
        const r = await api.net.request(req)
        status = Number(r?.status || 0)
        const bodyText = String(r?.body || '')
        bad = status < 200 || status >= 300

        if (streamWanted) {
          const sse = { buf: '', done: false }
          sseFeed(sse, bodyText, (json) => {
            if (json?.error?.message) throw new Error(String(json.error.message))
            const delta = extractOpenAiDelta(json)
            if (typeof delta === 'string' && delta) out += delta
          })
        } else {
          const json = JSON.parse(bodyText || '{}')
          if (bad) throw new Error(json?.error?.message || bodyText || `HTTP ${status}`)
          out = json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text ?? json?.output_text ?? ''
          out = String(out || '')
        }

        if (bad) {
          let msg = String(bodyText || '').trim()
          try {
            const j = JSON.parse(msg || '{}')
            msg = String(j?.error?.message || msg || `HTTP ${status}`)
          } catch (_) {}
          throw new Error(msg || `HTTP ${status}`)
        }
      }

      await flush(true)
      await patchAssistantMessage(job, out)
    } catch (e) {
      const msg = String(e?.message || e || '请求失败')
      out = out || `（请求失败：${msg}）`
      try {
        await flush(true)
      } catch (_) {}
      await patchAssistantMessage(job, out)
    } finally {
      if (mid) {
        try {
          await api.storage.remove(streamKey(mid))
        } catch (_) {}
      }
      try {
        await api.storage.remove(jobKey(job.id))
      } catch (_) {}
    }
  }

  const css = `
  :root{--bg:#fff;--card:#fff;--muted:#6b7280;--text:#111827;--line:#e5e7eb;--pri:#2563eb;--bad:#dc2626;--ok:#16a34a;--r:12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;}
  *{box-sizing:border-box;}html,body{height:100%;overflow:hidden;}body{margin:0;background:var(--bg);color:var(--text);overflow:hidden;overscroll-behavior:none;}
  .wrap{height:100vh;overflow:hidden;display:flex;flex-direction:column;}
  .top{height:48px;display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:1px solid var(--line);background:#fff;}
  .title{font-weight:900;font-size:13px;letter-spacing:0.3px;margin-right:auto;}
  .btn{height:32px;padding:0 10px;border-radius:10px;border:1px solid var(--line);background:#fff;color:var(--text);cursor:pointer;font-size:12px;}
  .btn.pri{border-color:rgba(37,99,235,.25);background:rgba(37,99,235,.08);color:var(--pri);} .btn.bad{border-color:rgba(220,38,38,.25);background:rgba(220,38,38,.06);color:var(--bad);} .btn.ok{border-color:rgba(22,163,74,.25);background:rgba(22,163,74,.08);color:var(--ok);} .btn:disabled{opacity:.6;cursor:not-allowed;}
  .content{flex:1;min-height:0;display:flex;}
  .side{width:240px;border-right:1px solid var(--line);padding:10px;overflow:auto;overscroll-behavior:contain;}
  .main{flex:1;min-width:0;display:flex;flex-direction:column;}
  .role{display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--line);border-radius:12px;cursor:pointer;background:#fff;}
  .role+.role{margin-top:8px;} .role[data-active="1"]{border-color:rgba(37,99,235,.35);background:rgba(37,99,235,.04);}
  .avatar{width:28px;height:28px;border-radius:10px;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;background:#f9fafb;}
  .roleName{font-weight:800;font-size:12px;} .muted{color:var(--muted);font-size:12px;} .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;}
  .tabs{display:flex;gap:6px;align-items:center;} .tab{height:28px;padding:0 10px;border-radius:10px;border:1px solid var(--line);background:#fff;color:var(--text);cursor:pointer;font-size:12px;}
  .tab.on{border-color:rgba(37,99,235,.25);background:rgba(37,99,235,.08);color:var(--pri);}
  .chatList{display:flex;flex-direction:column;gap:8px;}
  .chatItem{padding:8px 10px;border:1px solid var(--line);border-radius:12px;background:#fff;cursor:pointer;}
  .chatItem[data-active="1"]{border-color:rgba(37,99,235,.35);background:rgba(37,99,235,.04);}
  .chatItem:hover{border-color:rgba(37,99,235,.25);background:rgba(37,99,235,.03);}
  .chatTop{display:flex;gap:8px;align-items:center;}
  .chatTitle{font-weight:900;font-size:12px;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .chatTime{font-size:11px;color:var(--muted);}
  .chatText{font-size:12px;color:var(--muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .sp{margin-left:auto;}
  .chat{flex:1;min-height:0;overflow:auto;padding:12px;background:#fafafa;overscroll-behavior:contain;}
  .composer{border-top:1px solid var(--line);padding:10px;display:flex;flex-direction:column;gap:8px;background:#fff;}
  .composeRow{display:flex;gap:8px;align-items:flex-end;}
  .draftImgs{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
  .draftImg{width:54px;height:54px;border:1px solid var(--line);border-radius:12px;position:relative;overflow:hidden;background:#fff;}
  .draftImg img{width:100%;height:100%;object-fit:cover;display:block;}
  .draftX{position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.92);cursor:pointer;line-height:18px;padding:0;font-size:14px;}
  .ta{flex:1;min-height:42px;max-height:160px;resize:vertical;border:1px solid var(--line);border-radius:12px;padding:9px 10px;font-size:12px;outline:none;}
  .msg{display:flex;gap:8px;margin-bottom:10px;} .bubble{max-width:880px;border:1px solid var(--line);border-radius:12px;padding:10px;background:#fff;box-shadow:0 6px 18px rgba(17,24,39,.06);} .msg.user{justify-content:flex-end;} .msg.user .bubble{background:rgba(37,99,235,.06);border-color:rgba(37,99,235,.18);}
  .msgHead{display:flex;align-items:center;gap:8px;margin-bottom:6px;} .msgRole{font-weight:900;font-size:12px;} .msgTime{font-size:11px;color:var(--muted);margin-left:auto;} .msgActions{display:flex;gap:6px;}
  .mini{height:26px;padding:0 8px;border-radius:10px;border:1px solid var(--line);background:#fff;cursor:pointer;font-size:12px;}
  .msgImgs{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 8px;}
  .msgImg{width:180px;height:120px;object-fit:cover;border-radius:12px;border:1px solid var(--line);background:#fff;display:block;}
  .prose{font-size:12px;line-height:1.65;word-break:break-word;} .prose pre{overflow:auto;padding:10px;background:#0b1220;color:#e5e7eb;border-radius:10px;border:1px solid rgba(255,255,255,.08);} .prose code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;}
  .prose p{margin:8px 0;} .prose ul,.prose ol{margin:8px 0 8px 18px;} .prose blockquote{margin:8px 0;padding:8px 10px;border-left:3px solid rgba(37,99,235,.35);background:rgba(37,99,235,.04);border-radius:10px;} .prose hr{border:0;border-top:1px solid var(--line);margin:10px 0;} .math-block{margin:8px 0;overflow-x:auto;}
  .prose .katex,.prose .katex-display{max-width:100%;}
  .prose span.katex{display:inline-block;overflow-x:auto;overflow-y:hidden;vertical-align:middle;}
  .prose .katex-display{overflow-x:auto;overflow-y:hidden;}
  .prose .katex-display>.katex{display:block;overflow-x:visible;}
  .mermaid-block{margin:8px 0;overflow-x:auto;cursor:zoom-in;}
  .mermaid-block svg{max-width:100%;height:auto;display:block;}
  .modal.mm{width:min(1100px,100%);height:640px;max-height:calc(100vh - 24px);display:flex;flex-direction:column;overflow:hidden;}
  .mmStage{margin-top:10px;flex:1;min-height:0;overflow:auto;border:1px solid var(--line);border-radius:12px;background:#fff;padding:10px;}
  .mmStage[data-mm-drag="1"]{cursor:grabbing;}
  .mmCanvas{display:inline-block;transform-origin:0 0;}
  .overlay{position:fixed;inset:0;background:rgba(17,24,39,.18);display:flex;align-items:center;justify-content:center;padding:12px;}
  .modal{width:min(760px,100%);max-height:calc(100vh - 24px);overflow:auto;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;box-shadow:0 10px 30px rgba(17,24,39,.12);}
  .card{border:1px solid var(--line);border-radius:12px;padding:10px;background:#fff;} .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;} .hr{height:1px;background:var(--line);margin:10px 0;}
  .field{width:100%;border:1px solid var(--line);background:#fff;color:var(--text);border-radius:10px;padding:9px 10px;font-size:12px;outline:none;} .field.sm{width:auto;min-width:180px;}
  `

  function mount() {
    // legacy DOM UI 已弃用（改为 React+MUI）
  }

  function fmtTime(ts) {
    try {
      const d = new Date(Number(ts || 0))
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    } catch (_) {
      return ''
    }
  }

  function renderTop() {
    emit()
    return
    const el = document.querySelector('[data-area="top"]')
    if (!(el instanceof HTMLElement)) return
    const on = !!state.data?.settings?.streamEnabled
    el.innerHTML = `
      <div class="title">💬 AI 聊天</div>
      <button class="btn ${on ? 'ok' : ''}" data-act="toggle-stream">${on ? '流式：开' : '流式：关'}</button>
      <button class="btn" data-act="open-providers">供应商</button>
      <button class="btn pri" data-act="new-role">新角色</button>
      <button class="btn pri" data-act="new-chat">新建聊天</button>
      <button class="btn" data-act="edit-role">角色设置</button>
    `
  }

  function renderSide() {
    emit()
    return
    const el = document.querySelector('[data-area="side"]')
    if (!(el instanceof HTMLElement)) return
    if (state.loading) return (el.innerHTML = `<div class="muted">加载中…</div>`)

    const roles = state.data?.roles || []
    const active = String(state.draft.activeRoleId || '')
    const tab = state.sideTab === 'chats' ? 'chats' : 'roles'

    function tabBtn(name, label) {
      const on = tab === name ? ' on' : ''
      return `<button class="tab${on}" data-act="side-tab" data-tab="${esc(name)}">${esc(label)}</button>`
    }

    function renderRoles() {
      return roles
        .map((r) => {
          const on = String(r.id) === active ? '1' : '0'
          return `
          <div class="role" data-act="pick-role" data-id="${esc(r.id)}" data-active="${on}">
            <div class="avatar">${esc(r.avatar || '🙂')}</div>
            <div style="min-width:0">
              <div class="roleName">${esc(r.name || '')}</div>
              <div class="muted">${esc(String(r.modelRef?.providerId || ''))} / ${esc(String(r.modelRef?.modelId || ''))}</div>
            </div>
            <div class="sp"></div>
            <button class="mini" data-act="edit-role-inline" data-id="${esc(r.id)}">设置</button>
          </div>
        `
        })
        .join('')
    }

    function renderChats() {
      const role = activeRole()
      if (!role || !state.data) return `<div class="muted">请选择角色</div>`
      const box = state.data.chatsByRole?.[String(role.id)]
      const chats = Array.isArray(box?.chats) ? box.chats : []
      const activeChatId = String(box?.activeChatId || '')
      if (!chats.length) return `<div class="muted">暂无会话</div>`

      const list = chats
        .slice()
        .sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0))
        .map((c) => {
          const on = String(c.id) === activeChatId ? '1' : '0'
          const msgs = Array.isArray(c.messages) ? c.messages : []
          const last = msgs.length ? msgs[msgs.length - 1] : null
          const who = last?.role === 'user' ? '你' : String(role.avatar || '🤖')
          const raw = String(last?.content || '').replace(/\s+/g, ' ').trim()
          const snippet = raw.length > 40 ? raw.slice(0, 40) + '…' : raw
          const hasImg = Array.isArray(last?.images) && last.images.length > 0
          const time = fmtTime(c.updatedAt || c.createdAt)
          return `
            <div class="chatItem" data-act="pick-chat" data-id="${esc(c.id)}" data-active="${on}">
              <div class="chatTop">
                <div class="chatTitle">${esc(String(c.title || '新聊天'))}</div>
                <div class="sp"></div>
                <div class="chatTime">${esc(time)}</div>
              </div>
              <div class="chatText">${esc(who)}：${esc(snippet || (hasImg ? '(图片)' : '(空)'))}</div>
            </div>
          `
        })
        .join('')

      return `<div class="chatList">${list}</div>`
    }

    el.innerHTML = `
      <div class="row" style="margin-bottom:10px">
        <div class="tabs">
          ${tabBtn('roles', '角色')}
          ${tabBtn('chats', '记录')}
        </div>
        <div class="sp"></div>
      </div>
      ${tab === 'roles' ? renderRoles() : renderChats()}
    `
  }

  function renderChat() {
    emit()
    return
    const el = document.querySelector('[data-area="chat"]')
    if (!(el instanceof HTMLElement)) return
    if (state.loading) return (el.innerHTML = `<div class="muted">加载中…</div>`)

    const role = activeRole()
    const chat = activeChat()
    if (!role || !chat) return (el.innerHTML = `<div class="muted">请选择角色</div>`)

    const items = Array.isArray(chat.messages) ? chat.messages : []
    if (!items.length) return (el.innerHTML = `<div class="muted">还没有消息。输入内容并发送。</div>`)

    el.innerHTML = items
      .map((m) => {
        const isUser = m.role === 'user'
        const who = isUser ? '你' : `${String(role.avatar || '🤖')} ${String(role.name || 'AI')}`
        const time = fmtTime(m.createdAt)
        const imgPaths = isUser ? normImagePaths(m.images) : []
        const imgs =
          imgPaths.length > 0
            ? `<div class="msgImgs">
              ${imgPaths
                .map((p) => {
                  const cached = uiRefImgCache.get(p)
                  const src = typeof cached === 'string' && cached ? cached : REF_IMG_PLACEHOLDER
                  return `<img class="msgImg" data-ref-img="${esc(p)}" src="${esc(src)}" alt="图片" />`
                })
                .join('')}
            </div>`
            : ''

        const text = String(m.content || '')
        const textHtml = text ? `<div class="prose">${esc(text).replace(/\n/g, '<br />')}</div>` : ''

        const body = isUser ? `${imgs}${textHtml}` : `<div class="prose" data-render-assistant="1" data-mid="${esc(m.id)}"></div>`
        const actions = isUser
          ? ''
          : `<div class="msgActions"><button class="mini" data-act="copy-msg" data-id="${esc(m.id)}">复制</button></div>`

        return `
          <div class="msg ${isUser ? 'user' : 'assistant'}" data-mid="${esc(m.id)}">
            <div class="bubble">
              <div class="msgHead">
                <div class="msgRole">${esc(who)}</div>
                <div class="msgTime">${esc(time)}</div>
                ${actions}
              </div>
              ${body}
            </div>
          </div>
        `
      })
      .join('')

    const holders = Array.from(el.querySelectorAll('[data-render-assistant="1"]'))
    for (const h of holders) {
      if (!(h instanceof HTMLElement)) continue
      const mid = String(h.getAttribute('data-mid') || '')
      const msg = items.find((x) => String(x?.id) === mid)
      let content = String(msg?.content || '')
      if (msg?.pending && msg?.streaming) {
        const cached = uiStreamCache.get(mid)
        if (typeof cached === 'string' && cached) content = cached
      }
      renderAssistantInto(h, content)
    }

    hydrateRefImages(el)
  }

  function hydrateRefImages(root) {
    if (!(root instanceof HTMLElement)) return
    if (typeof api?.files?.readRefImage !== 'function') return

    const els = Array.from(root.querySelectorAll('[data-ref-img]'))
    const byPath = new Map()

    for (const el of els) {
      if (!(el instanceof HTMLImageElement)) continue
      const path = String(el.getAttribute('data-ref-img') || '').trim()
      if (!path) continue

      const cached = uiRefImgCache.get(path)
      if (typeof cached === 'string' && cached) {
        el.src = cached
        continue
      }

      if (!byPath.has(path)) byPath.set(path, [])
      byPath.get(path).push(el)
    }

    for (const [path, list] of byPath) {
      if (uiRefImgPending.has(path)) continue
      uiRefImgPending.add(path)
      api.files
        .readRefImage(path)
        .then((dataUrl) => {
          const ok = typeof dataUrl === 'string' && dataUrl.startsWith('data:')
          if (ok) uiRefImgCache.set(path, dataUrl)
          const src = ok ? dataUrl : REF_IMG_PLACEHOLDER
          for (const img of list) {
            if (!(img instanceof HTMLImageElement)) continue
            if (!img.isConnected) continue
            img.src = src
          }
        })
        .catch(() => {})
        .finally(() => {
          uiRefImgPending.delete(path)
        })
    }
  }

  function renderComposer() {
    emit()
    return
    const el = document.querySelector('[data-area="composer"]')
    if (!(el instanceof HTMLElement)) return
    const disabled = state.loading || state.sending || !activeRole()
    const draftImages = Array.isArray(state.draft.images) ? state.draft.images : []
    const canPickImages = !disabled && api?.files?.pickImages
    const imgsHtml = draftImages.length
      ? `<div class="draftImgs">
        ${draftImages
          .map((img) => {
            const src = typeof img?.dataUrl === 'string' ? img.dataUrl : ''
            const id = String(img?.id || '')
            const name = String(img?.name || '图片')
            if (!src || !id) return ''
            return `
              <div class="draftImg">
                <img src="${esc(src)}" alt="${esc(name)}" />
                <button class="draftX" data-act="rm-draft-img" data-id="${esc(id)}" title="移除">×</button>
              </div>
            `
          })
          .join('')}
      </div>`
      : ''
    el.innerHTML = `
      ${imgsHtml}
      <div class="composeRow">
        <button class="btn" data-act="pick-images" ${canPickImages ? '' : 'disabled'} title="选择图片">图片</button>
        <textarea class="ta" data-bind="input" placeholder="输入消息…（Enter 发送 / Shift+Enter 换行；支持粘贴图片）" ${disabled ? 'disabled' : ''}>${esc(
          state.draft.input || '',
        )}</textarea>
        <button class="btn pri" data-act="send" ${disabled ? 'disabled' : ''}>${state.sending ? '发送中…' : '发送'}</button>
      </div>
    `
  }

  function renderModal() {
    emit()
    return
    const el = document.querySelector('[data-area="modal"]')
    if (!(el instanceof HTMLElement)) return
    if (!state.modal) return (el.innerHTML = '')

    if (state.modal === 'mermaid') {
      const len = Array.isArray(state.mermaid.items) ? state.mermaid.items.length : 0
      const idx = len ? clamp(state.mermaid.index, 0, len - 1) : 0
      const scale = clamp(state.mermaid.scale, 0.2, 6)
      const svg = len ? String(state.mermaid.items[idx]?.svg || '') : ''

      el.innerHTML = `
        <div class="overlay" data-act="close-modal">
          <div class="modal mm" data-stop="1" data-mm-modal="1">
            <div class="row">
              <div class="title" style="margin:0">Mermaid 预览 <span class="muted" data-mm-label="1">${len ? `${idx + 1}/${len}` : ''}</span></div>
              <div class="sp"></div>
              <button class="btn" data-act="mm-prev" title="上一张" ${len <= 1 ? 'disabled' : ''}>←</button>
              <button class="btn" data-act="mm-next" title="下一张" ${len <= 1 ? 'disabled' : ''}>→</button>
              <button class="btn" data-act="mm-zoom-out" title="缩小">－</button>
              <div class="muted" data-mm-zoom="1" style="min-width:54px;text-align:center">${Math.round(scale * 100)}%</div>
              <button class="btn" data-act="mm-zoom-in" title="放大">＋</button>
              <button class="btn" data-act="mm-reset" title="重置缩放">重置</button>
              <button class="btn" data-act="close-modal">关闭</button>
            </div>
            <div class="mmStage" data-mm-stage="1">
              <div class="mmCanvas" data-mm-canvas="1" style="transform:scale(${scale})">${svg || '<div class="muted">无可预览的 Mermaid</div>'}</div>
            </div>
          </div>
        </div>
      `
      return
    }

    if (state.modal === 'role') {
      const role = state.data?.roles.find((r) => String(r?.id) === String(state.draft.editRoleId || ''))
      const ps = state.data?.settings?.providers || []
      const pick = String(state.draft.roleModelId || '')
      const showCustom = pick === '__custom__'

      el.innerHTML = `
        <div class="overlay" data-act="close-modal">
          <div class="modal" data-stop="1">
            <div class="row">
              <div class="title" style="margin:0">角色设置：${esc(role?.name || '')}</div>
              <div class="sp"></div>
              <button class="btn" data-act="close-modal">关闭</button>
            </div>
            <div class="hr"></div>
            <div class="card">
              <div class="muted">名称</div>
              <input class="field" data-bind="roleName" value="${esc(state.draft.roleName || '')}" />
              <div class="hr"></div>
              <div class="muted">头像（emoji / 文本）</div>
              <input class="field" data-bind="roleAvatar" value="${esc(state.draft.roleAvatar || '')}" />
              <div class="hr"></div>
              <div class="muted">System Prompt</div>
              <textarea class="field mono" data-bind="roleSystemPrompt" style="min-height:140px" placeholder="写入系统提示词…">${esc(
                state.draft.roleSystemPrompt || '',
              )}</textarea>
              <div class="hr"></div>
              <div class="row">
                <div style="min-width:220px">
                  <div class="muted">供应商（providerId）</div>
                  <select class="field sm" data-bind="roleProviderId">
                    ${ps
                      .map(
                        (p) =>
                          `<option value="${esc(p.id)}"${String(p.id) === String(state.draft.roleProviderId || '') ? ' selected' : ''}>${esc(
                            p.name,
                          )} (${esc(p.id)})</option>`,
                      )
                      .join('')}
                  </select>
                </div>
                <div style="min-width:280px">
                  <div class="muted">模型ID</div>
                  <select class="field sm" data-bind="roleModelId">
                    <option value="">（未选择）</option>
                    ${state.models.items
                      .map((id) => `<option value="${esc(id)}"${id === pick ? ' selected' : ''}>${esc(id)}</option>`)
                      .join('')}
                    <option value="__custom__"${showCustom ? ' selected' : ''}>自定义…</option>
                  </select>
                </div>
                <div class="sp"></div>
                <button class="btn" data-act="refresh-models" ${state.models.loading ? 'disabled' : ''}>${state.models.loading ? '刷新中…' : '刷新模型'}</button>
              </div>
              ${state.models.error ? `<div class="muted" style="margin-top:8px;color:var(--bad)">${esc(state.models.error)}</div>` : ''}
              ${
                showCustom
                  ? `<div style="margin-top:10px">
                      <div class="muted">自定义模型ID</div>
                      <input class="field mono" data-bind="roleCustomModelId" placeholder="例如：gpt-4.1-mini" value="${esc(
                        state.draft.roleCustomModelId || '',
                      )}" />
                    </div>`
                  : ''
              }
              <div class="hr"></div>
              <div class="row">
                <div style="min-width:260px">
                  <div class="muted">温度（0~2）</div>
                  <input class="field sm mono" data-bind="roleTemperature" value="${esc(String(state.draft.roleTemperature || '0.7'))}" />
                </div>
                <div class="sp"></div>
                <button class="btn ok" data-act="save-role">保存</button>
                <button class="btn bad" data-act="ask-delete-role" data-id="${esc(role?.id || '')}">删除角色</button>
              </div>
            </div>
          </div>
        </div>
      `
      return
    }

    if (state.modal === 'providers') {
      const ps = state.data?.settings?.providers || []
      const editing = String(state.draft.editProviderId || '')

      el.innerHTML = `
        <div class="overlay" data-act="close-modal">
          <div class="modal" data-stop="1">
            <div class="row">
              <div class="title" style="margin:0">供应商</div>
              <div class="sp"></div>
              <button class="btn" data-act="new-provider">新建</button>
              <button class="btn" data-act="close-modal">关闭</button>
            </div>
            <div class="hr"></div>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${ps
                .map((p) => {
                  const isEditing = String(p.id) === editing
                  return `
                    <div class="card">
                      <div class="row">
                        <div style="font-weight:900;font-size:12px">${esc(p.name || '')}</div>
                        <div class="muted mono">${esc(p.id)}</div>
                        <div class="sp"></div>
                        <button class="btn" data-act="edit-provider" data-id="${esc(p.id)}">${isEditing ? '收起' : '编辑'}</button>
                        <button class="btn bad" data-act="ask-delete-provider" data-id="${esc(p.id)}">删除</button>
                      </div>
                      ${
                        isEditing
                          ? `
                          <div class="hr"></div>
                          <div class="muted">名称</div>
                          <input class="field" data-bind="providerName" value="${esc(state.draft.providerName || '')}" />
                          <div class="hr"></div>
                          <div class="muted">Base URL（OpenAI 兼容）</div>
                          <input class="field mono" data-bind="providerBaseUrl" placeholder="https://api.openai.com/v1" value="${esc(String(state.draft.providerBaseUrl || ''))}" />
                          <div class="hr"></div>
                          <div class="muted">API Key</div>
                          <input class="field mono" data-bind="providerApiKey" placeholder="sk-..." value="${esc(String(state.draft.providerApiKey || ''))}" />
                          <div class="hr"></div>
                          <div class="row">
                            <button class="btn ok" data-act="save-provider">保存</button>
                            <button class="btn" data-act="close-provider-editor">收起</button>
                          </div>
                        `
                          : ''
                      }
                    </div>
                  `
                })
                .join('')}
            </div>
          </div>
        </div>
      `
      return
    }

    if (state.modal === 'confirm') {
      const delRoleId = String(state.draft.deleteRoleId || '')
      const delProviderId = String(state.draft.deleteProviderId || '')
      const msg = delRoleId ? '确认删除该角色？（聊天记录也会删除）' : delProviderId ? '确认删除该供应商？' : ''

      el.innerHTML = `
        <div class="overlay" data-act="close-modal">
          <div class="modal" data-stop="1" style="max-width:520px">
            <div class="row">
              <div class="title" style="margin:0">确认</div>
              <div class="sp"></div>
              <button class="btn" data-act="close-modal">关闭</button>
            </div>
            <div class="hr"></div>
            <div class="muted">${esc(msg)}</div>
            <div class="hr"></div>
            <div class="row">
              <div class="sp"></div>
              <button class="btn bad" data-act="confirm-delete">删除</button>
            </div>
          </div>
        </div>
      `
      return
    }

    el.innerHTML = ''
  }

  function render() {
    emit()
  }

  function scrollToBottomSoon() {
    // UI 负责滚动逻辑（React）
  }

  let uiPollTimer = 0
  let uiLastSyncMs = 0
  const uiStreamCache = new Map()

  function startUiPollers() {
    if (uiPollTimer) return
    uiPollTimer = window.setInterval(() => {
      uiPollTick().catch(() => {})
    }, 350)
  }

  async function syncDataFromStorage() {
    const keepActive = String(state.draft.activeRoleId || '')
    const keepInput = String(state.draft.input || '')
    const keepImages = Array.isArray(state.draft.images) ? state.draft.images : []
    const raw = await api.storage.get(STORAGE_KEY)
    state.data = normalizeData(raw)
    if (keepActive) state.draft.activeRoleId = keepActive
    else state.draft.activeRoleId = String(state.data?.ui?.activeRoleId || '')
    state.draft.input = keepInput
    state.draft.images = keepImages
  }

  async function uiPollTick() {
    if (state.loading || !state.data) return

    const role = activeRole()
    const chat = activeChat()
    if (!role || !chat) return

    const items = Array.isArray(chat.messages) ? chat.messages : []
    const pending = items.filter((m) => m && m.role === 'assistant' && m.pending).slice(-3)

    if (pending.length) {
      let changed = false
      for (const m of pending) {
        if (!m.streaming) continue
        const s = await api.storage.get(streamKey(String(m.id || '')))
        const text = String(s?.text || '')
        if (!text) continue
        const mid = String(m.id || '')
        if (uiStreamCache.get(mid) === text) continue
        uiStreamCache.set(mid, text)
        m.content = text
        changed = true
      }
      if (changed) emit()

      const t = now()
      if (t - uiLastSyncMs > 900) {
        uiLastSyncMs = t
        await syncDataFromStorage()
        emit()
      }

      if (state.sendingJobId) {
        const job = await api.storage.get(jobKey(state.sendingJobId))
        if (!job) state.sendingJobId = ''
      }

      return
    }

    uiStreamCache.clear()

    if (state.sending || state.sendingJobId) {
      state.sending = false
      state.sendingJobId = ''
      emit()
    }
  }

  function closeModal() {
    cancelMermaidDrag()
    state.modal = ''
    state.draft.deleteRoleId = ''
    state.draft.deleteProviderId = ''
    render()
  }

  function createRole() {
    if (!state.data) return
    const rid = uid('r')
    const cid = uid('c')
    const role = {
      id: rid,
      name: '新角色',
      avatar: '🙂',
      systemPrompt: '',
      temperature: 0.7,
      modelRef: { providerId: String(state.data.settings.providers?.[0]?.id || ''), modelId: '' },
      createdAt: now(),
      updatedAt: now(),
    }
    ensureRoleDefaults(role)
    state.data.roles.unshift(role)
    if (!state.data.chatsByRole || typeof state.data.chatsByRole !== 'object') state.data.chatsByRole = {}
    state.data.chatsByRole[rid] = {
      activeChatId: cid,
      chats: [{ id: cid, title: '新聊天', createdAt: now(), updatedAt: now(), messages: [] }],
    }
    state.draft.activeRoleId = rid
    save().catch(() => {})
    openRoleEditor(rid)
  }

  function openRoleEditor(roleId) {
    if (!state.data) return
    const rid = String(roleId || '')
    const role = state.data.roles.find((r) => String(r?.id) === rid)
    if (!role) return
    ensureRoleDefaults(role)

    state.draft.editRoleId = rid
    state.draft.roleName = String(role.name || '')
    state.draft.roleAvatar = String(role.avatar || '')
    state.draft.roleSystemPrompt = String(role.systemPrompt || '')
    state.draft.roleTemperature = String(role.temperature ?? 0.7)
    state.draft.roleProviderId = String(role.modelRef?.providerId || '')
    const curModelId = String(role.modelRef?.modelId || '').trim()
    state.draft.roleModelId = curModelId ? '__custom__' : ''
    state.draft.roleCustomModelId = curModelId

    state.modal = 'role'
    render()
    refreshModels(state.draft.roleProviderId, false).catch(() => {})
  }

  function saveRoleEditor() {
    if (!state.data) return
    const rid = String(state.draft.editRoleId || '')
    const role = state.data.roles.find((r) => String(r?.id) === rid)
    if (!role) return

    const name = String(state.draft.roleName || '').trim() || '未命名角色'
    const avatar = String(state.draft.roleAvatar || '').trim() || '🙂'
    const sys = String(state.draft.roleSystemPrompt || '').trim()
    const temperature = clampTemp(state.draft.roleTemperature)
    const providerId = String(state.draft.roleProviderId || '').trim()
    let modelId = String(state.draft.roleModelId || '').trim()
    if (modelId === '__custom__') modelId = String(state.draft.roleCustomModelId || '').trim()

    role.name = name
    role.avatar = avatar
    role.systemPrompt = sys
    role.temperature = temperature
    role.modelRef = { providerId, modelId }
    role.updatedAt = now()

    save().catch(() => {})
    closeModal()
  }

  function deleteRole(roleId) {
    if (!state.data) return
    const rid = String(roleId || '')
    state.data.roles = state.data.roles.filter((r) => String(r?.id) !== rid)
    if (state.data.chatsByRole && typeof state.data.chatsByRole === 'object') delete state.data.chatsByRole[rid]

    if (!state.data.roles.length) {
      const d = defaultData()
      state.data.settings.providers = state.data.settings.providers.length ? state.data.settings.providers : d.settings.providers
      state.data.roles = d.roles
      state.data.chatsByRole = d.chatsByRole
      state.data.ui = d.ui
    }

    state.draft.activeRoleId = String(state.data.roles[0]?.id || '')
    save().catch(() => {})
  }

  function openProvidersEditor() {
    state.draft.editProviderId = ''
    state.modal = 'providers'
    render()
  }

  function openProviderInlineEditor(providerId) {
    const p = getProvider(providerId)
    if (!p) return
    state.draft.editProviderId = String(p.id)
    state.draft.providerName = String(p.name || '')
    state.draft.providerBaseUrl = String(p.baseUrl || '')
    state.draft.providerApiKey = String(p.apiKey || '')
    render()
  }

  function saveProviderInlineEditor() {
    const pid = String(state.draft.editProviderId || '')
    const p = getProvider(pid)
    if (!p) return

    p.name = String(state.draft.providerName || '').trim() || '未命名供应商'
    p.baseUrl = String(state.draft.providerBaseUrl || '').trim() || 'http://'
    p.apiKey = String(state.draft.providerApiKey || '').trim()
    p.modelsCache = { items: [], fetchedAt: 0 }

    state.draft.editProviderId = ''
    save().catch(() => {})
    render()
  }

  function createProvider() {
    if (!state.data) return
    const pid = uid('p')
    state.data.settings.providers.unshift({
      id: pid,
      name: '新供应商（OpenAI 兼容）',
      baseUrl: 'http://',
      apiKey: '',
      modelsCache: { items: [], fetchedAt: 0 },
    })
    save().catch(() => {})
    openProviderInlineEditor(pid)
  }

  function deleteProvider(providerId) {
    if (!state.data) return
    const pid = String(providerId || '')
    if (state.data.settings.providers.length <= 1) return api.ui?.showToast?.('至少保留一个供应商')

    state.data.settings.providers = state.data.settings.providers.filter((p) => String(p?.id) !== pid)

    const fallback = String(state.data.settings.providers[0]?.id || '')
    for (const r of state.data.roles) {
      if (!r?.modelRef) continue
      if (String(r.modelRef.providerId) === pid) r.modelRef.providerId = fallback
    }

    save().catch(() => {})
  }

  function ensureChatsBox(roleId) {
    if (!state.data) return null
    const rid = String(roleId || '')
    if (!rid) return null
    if (!state.data.chatsByRole || typeof state.data.chatsByRole !== 'object') state.data.chatsByRole = {}
    if (!state.data.chatsByRole[rid] || typeof state.data.chatsByRole[rid] !== 'object') state.data.chatsByRole[rid] = { activeChatId: '', chats: [] }
    const box = state.data.chatsByRole[rid]
    if (!Array.isArray(box.chats)) box.chats = []
    box.activeChatId = String(box.activeChatId || '')
    if (!box.chats.length) {
      const cid = uid('c')
      box.chats = [{ id: cid, title: '新聊天', createdAt: now(), updatedAt: now(), messages: [] }]
      box.activeChatId = cid
    }
    if (!box.activeChatId || !box.chats.some((c) => String(c?.id) === box.activeChatId)) box.activeChatId = String(box.chats[0]?.id || '')
    return box
  }

  function createChatForRole(roleId) {
    const rid = String(roleId || '')
    const box = ensureChatsBox(rid)
    if (!box) return null
    const cid = uid('c')
    const chat = { id: cid, title: '新聊天', createdAt: now(), updatedAt: now(), messages: [] }
    box.chats.unshift(chat)
    box.activeChatId = cid
    return chat
  }

  function createChatForActiveRole() {
    const role = activeRole()
    if (!role) return api.ui?.showToast?.('请先选择角色')
    createChatForRole(String(role.id))
    state.sideTab = 'chats'
    save().catch(() => {})
    render()
    scrollToBottomSoon()
  }

  function pickChatForActiveRole(chatId) {
    const role = activeRole()
    if (!role || !state.data) return
    const box = ensureChatsBox(String(role.id))
    if (!box) return
    const cid = String(chatId || '')
    if (!cid || !box.chats.some((c) => String(c?.id) === cid)) return
    box.activeChatId = cid
    save().catch(() => {})
    render()
    scrollToBottomSoon()
  }

  function onClick(e) {
    const t0 = e?.target
    if (!(t0 instanceof Element)) return

    let t = t0
    let act = ''
    while (t) {
      if (t instanceof Element && t.getAttribute('data-stop') === '1') return
      act = (t instanceof Element && t.getAttribute('data-act')) || ''
      if (act) break
      t = t.parentElement
    }
    if (!t || !act) return

    if (act === 'open-mermaid') {
      openMermaidViewer(t)
      return
    }

    if (act === 'mm-prev' || act === 'mm-next') {
      if (state.modal !== 'mermaid') return
      const len = Array.isArray(state.mermaid.items) ? state.mermaid.items.length : 0
      if (!len) return
      const delta = act === 'mm-prev' ? -1 : 1
      state.mermaid.index = (state.mermaid.index + delta + len) % len
      renderMermaidModalDom(true)
      return
    }

    if (act === 'mm-zoom-in' || act === 'mm-zoom-out' || act === 'mm-reset') {
      if (state.modal !== 'mermaid') return
      if (act === 'mm-reset') state.mermaid.scale = 1
      else {
        const factor = act === 'mm-zoom-in' ? 1.12 : 1 / 1.12
        state.mermaid.scale = clamp(Number(state.mermaid.scale || 1) * factor, 0.2, 6)
      }
      applyMermaidScaleDom()
      return
    }

    if (act === 'side-tab') {
      const tab = String(t.getAttribute('data-tab') || '')
      state.sideTab = tab === 'chats' ? 'chats' : 'roles'
      render()
      return
    }

    if (act === 'close-modal') {
      closeModal()
      return
    }

    if (act === 'toggle-stream') {
      if (!state.data) return
      state.data.settings.streamEnabled = !state.data.settings.streamEnabled
      save().catch(() => {})
      renderTop()
      return
    }

    if (act === 'open-providers') return openProvidersEditor()
    if (act === 'new-role') return createRole()
    if (act === 'new-chat') return createChatForActiveRole()

    if (act === 'edit-role') {
      const r = activeRole()
      if (r) openRoleEditor(String(r.id))
      return
    }

    if (act === 'edit-role-inline') return openRoleEditor(String(t.getAttribute('data-id') || ''))

    if (act === 'pick-role') {
      state.draft.activeRoleId = String(t.getAttribute('data-id') || '')
      ensureChatsBox(state.draft.activeRoleId)
      save().catch(() => {})
      render()
      scrollToBottomSoon()
      return
    }

    if (act === 'pick-chat') return pickChatForActiveRole(String(t.getAttribute('data-id') || ''))

    if (act === 'pick-images') return pickImages()
    if (act === 'rm-draft-img') {
      removeDraftImage(String(t.getAttribute('data-id') || ''))
      renderComposer()
      return
    }

    if (act === 'send') return sendChat()
    if (act === 'refresh-models') return refreshModels(String(state.draft.roleProviderId || ''), true)
    if (act === 'save-role') return saveRoleEditor()

    if (act === 'ask-delete-role') {
      state.draft.deleteRoleId = String(t.getAttribute('data-id') || '')
      state.draft.deleteProviderId = ''
      state.modal = 'confirm'
      render()
      return
    }

    if (act === 'new-provider') return createProvider()

    if (act === 'edit-provider') {
      const pid = String(t.getAttribute('data-id') || '')
      if (String(state.draft.editProviderId || '') === pid) state.draft.editProviderId = ''
      else openProviderInlineEditor(pid)
      render()
      return
    }

    if (act === 'close-provider-editor') {
      state.draft.editProviderId = ''
      render()
      return
    }

    if (act === 'save-provider') return saveProviderInlineEditor()

    if (act === 'ask-delete-provider') {
      state.draft.deleteProviderId = String(t.getAttribute('data-id') || '')
      state.draft.deleteRoleId = ''
      state.modal = 'confirm'
      render()
      return
    }

    if (act === 'confirm-delete') {
      const rid = String(state.draft.deleteRoleId || '')
      const pid = String(state.draft.deleteProviderId || '')
      closeModal()
      if (rid) deleteRole(rid)
      if (pid) deleteProvider(pid)
      render()
      return
    }

    if (act === 'copy-msg') {
      const id = String(t.getAttribute('data-id') || '')
      const chat = activeChat()
      const m = chat?.messages?.find((x) => String(x?.id) === id)
      if (!m) return
      api.clipboard?.writeText?.(String(m.content || '')).then(
        () => api.ui?.showToast?.('已复制'),
        () => api.ui?.showToast?.('复制失败'),
      )
      return
    }
  }

  function onWheel(e) {
    if (state.modal !== 'mermaid') return
    const t = e?.target
    if (!(t instanceof Element)) return
    const stage = document.querySelector('[data-mm-stage="1"]')
    if (!(stage instanceof HTMLElement)) return
    if (!stage.contains(t)) return

    e.preventDefault()
    e.stopPropagation()
    const dir = Number(e?.deltaY || 0) < 0 ? 1 : -1
    const factor = dir > 0 ? 1.08 : 1 / 1.08
    state.mermaid.scale = clamp(Number(state.mermaid.scale || 1) * factor, 0.2, 6)
    applyMermaidScaleDom()
  }

  function onMouseDown(e) {
    if (state.modal !== 'mermaid') return
    const t = e?.target
    if (!(t instanceof Element)) return
    if (e.button !== 1) return

    const stage = document.querySelector('[data-mm-stage="1"]')
    if (!(stage instanceof HTMLElement)) return
    if (!stage.contains(t)) return

    e.preventDefault()
    e.stopPropagation()

    mermaidDrag = {
      stage,
      x: Number(e.clientX || 0),
      y: Number(e.clientY || 0),
      sl: Number(stage.scrollLeft || 0),
      st: Number(stage.scrollTop || 0),
    }
    stage.setAttribute('data-mm-drag', '1')

    try {
      window.addEventListener('mousemove', onMouseMoveMermaid, { passive: false })
      window.addEventListener('mouseup', onMouseUpMermaid, { passive: true })
      window.addEventListener('blur', onMouseUpMermaid, { passive: true })
    } catch (_) {
      window.addEventListener('mousemove', onMouseMoveMermaid)
      window.addEventListener('mouseup', onMouseUpMermaid)
      window.addEventListener('blur', onMouseUpMermaid)
    }
  }

  function onInput(e) {
    const t = e?.target
    if (!(t instanceof HTMLElement)) return
    const bind = t.getAttribute('data-bind') || ''
    if (!bind) return
    state.draft[bind] = t.value
  }

  function onChange(e) {
    const t = e?.target
    if (!(t instanceof HTMLElement)) return
    const bind = t.getAttribute('data-bind') || ''
    if (!bind) return
    state.draft[bind] = t.value

    if (bind === 'roleProviderId') {
      state.models = { loading: false, error: '', items: [] }
      state.draft.roleModelId = ''
      state.draft.roleCustomModelId = ''
      refreshModels(String(state.draft.roleProviderId || ''), false).catch(() => {})
      render()
      return
    }

    if (bind === 'roleModelId') {
      render()
      return
    }
  }

  function onKeyDown(e) {
    const t = e?.target
    if (!(t instanceof HTMLElement)) return
    if (t.getAttribute('data-bind') !== 'input') return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendChat()
    }
  }

  function onPaste(e) {
    const t = e?.target
    if (!(t instanceof HTMLElement)) return
    if (t.getAttribute('data-bind') !== 'input') return
    if (state.loading || state.sending) return

    const dt = e?.clipboardData
    const items = dt?.items ? Array.from(dt.items) : []
    const files = []
    for (const it of items) {
      if (!it || it.kind !== 'file') continue
      const type = String(it.type || '')
      if (!type.startsWith('image/')) continue
      const f = it.getAsFile?.()
      if (f) files.push(f)
    }
    if (!files.length) return

    const left = Math.max(0, MAX_DRAFT_IMAGES - (Array.isArray(state.draft.images) ? state.draft.images.length : 0))
    if (!left) return api.ui?.showToast?.(`最多选择 ${MAX_DRAFT_IMAGES} 张图片`)

    e.preventDefault()
    e.stopPropagation()

    ;(async () => {
      let added = 0
      for (const f of files.slice(0, left)) {
        try {
          const dataUrl = await readFileAsDataUrl(f)
          if (addDraftImage(String(f?.name || '粘贴图片'), dataUrl)) added++
        } catch (_) {}
      }
      if (!added) api.ui?.showToast?.('未识别到图片')
      renderComposer()
    })().catch(() => {})
  }

  async function init() {
    await ensureRenderer().catch(() => {})
    await load()
    startUiPollers()
    render()
  }

  ;(window as any).__fastWindowAiChat = {
    api,
    getState: () => state,
    getSnapshot: () => ver,
    subscribe,
    fmtTime,
    activeRole,
    activeChat,
    getProvider,
    renderAssistantInto,
    actions: {
      emit,
      setSideTab: (tab) => {
        state.sideTab = tab === 'chats' ? 'chats' : 'roles'
        emit()
      },
      setActiveRole: (roleId) => {
        state.draft.activeRoleId = String(roleId || '')
        ensureChatsBox(state.draft.activeRoleId)
        save().catch(() => {})
        emit()
      },
      setActiveChat: (chatId) => {
        pickChatForActiveRole(String(chatId || ''))
      },
      toggleStream: () => {
        if (!state.data) return
        state.data.settings.streamEnabled = !state.data.settings.streamEnabled
        save().catch(() => {})
        emit()
      },
      closeModal: () => closeModal(),
      openProviders: () => openProvidersEditor(),
      createProvider: () => createProvider(),
      openProviderEditor: (providerId) => openProviderInlineEditor(String(providerId || '')),
      closeProviderEditor: () => {
        state.draft.editProviderId = ''
        emit()
      },
      saveProvider: () => saveProviderInlineEditor(),
      askDeleteProvider: (providerId) => {
        state.draft.deleteProviderId = String(providerId || '')
        state.draft.deleteRoleId = ''
        state.modal = 'confirm'
        emit()
      },
      openRoleEditor: (roleId) => openRoleEditor(String(roleId || '')),
      createRole: () => createRole(),
      saveRole: () => saveRoleEditor(),
      askDeleteRole: (roleId) => {
        state.draft.deleteRoleId = String(roleId || '')
        state.draft.deleteProviderId = ''
        state.modal = 'confirm'
        emit()
      },
      confirmDelete: () => {
        const rid = String(state.draft.deleteRoleId || '')
        const pid = String(state.draft.deleteProviderId || '')
        closeModal()
        if (rid) deleteRole(rid)
        if (pid) deleteProvider(pid)
        emit()
      },
      openMermaidViewer: (rootEl, srcEl) => {
        const root = rootEl instanceof Element ? rootEl : document.body
        const blocks = Array.from(root.querySelectorAll?.('.mermaid-block[data-mermaid=\"1\"]') || [])
        const items = []
        for (const b of blocks) {
          const svg = b instanceof HTMLElement ? String(b.innerHTML || '') : ''
          if (!svg) continue
          items.push({ svg })
        }
        if (!items.length) return

        let idx = 0
        const src = srcEl instanceof Element ? srcEl : null
        if (src) {
          const i = blocks.findIndex((b) => b === src || (b instanceof HTMLElement && b.contains(src)))
          if (i >= 0) idx = i
        }
        state.mermaid.items = items
        state.mermaid.index = clamp(idx, 0, Math.max(0, items.length - 1))
        state.mermaid.scale = 1
        state.modal = 'mermaid'
        emit()
      },
      mermaidPrev: () => {
        const len = Array.isArray(state.mermaid.items) ? state.mermaid.items.length : 0
        if (!len) return
        state.mermaid.index = (Number(state.mermaid.index || 0) - 1 + len) % len
        emit()
      },
      mermaidNext: () => {
        const len = Array.isArray(state.mermaid.items) ? state.mermaid.items.length : 0
        if (!len) return
        state.mermaid.index = (Number(state.mermaid.index || 0) + 1) % len
        emit()
      },
      mermaidZoom: (dir) => {
        const factor = Number(dir || 0) >= 0 ? 1.12 : 1 / 1.12
        state.mermaid.scale = clamp(Number(state.mermaid.scale || 1) * factor, 0.2, 6)
        emit()
      },
      mermaidReset: () => {
        state.mermaid.scale = 1
        emit()
      },
      createChat: () => createChatForActiveRole(),
      setDraft: (key, value) => {
        const k = String(key || '')
        if (!k) return
        ;(state.draft as any)[k] = value
        emit()
      },
      roleProviderChanged: (providerId) => {
        state.draft.roleProviderId = String(providerId || '')
        state.models = { loading: false, error: '', items: [] }
        state.draft.roleModelId = ''
        state.draft.roleCustomModelId = ''
        refreshModels(String(state.draft.roleProviderId || ''), false).catch(() => {})
        emit()
      },
      roleModelChanged: (modelId) => {
        state.draft.roleModelId = String(modelId || '')
        emit()
      },
      refreshModels: (providerId, force) => refreshModels(String(providerId || ''), !!force),
      removeDraftImage: (id) => {
        removeDraftImage(String(id || ''))
        emit()
      },
      pickImages: () => pickImages(),
      addDraftImagesFromFiles: async (files) => {
        const list = Array.isArray(files) ? files : []
        const left = Math.max(0, MAX_DRAFT_IMAGES - (Array.isArray(state.draft.images) ? state.draft.images.length : 0))
        let added = 0
        for (const f of list.slice(0, left)) {
          try {
            const dataUrl = await readFileAsDataUrl(f)
            if (addDraftImage(String(f?.name || '图片'), dataUrl)) added++
          } catch (_) {}
        }
        if (!added) api.ui?.showToast?.('未识别到图片')
        emit()
      },
      send: () => sendChat(),
    },
  }

  init()
})()
