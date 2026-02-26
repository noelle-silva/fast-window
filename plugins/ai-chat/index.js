// ai-chat (iframe sandbox) (entry: index.js)
;(function () {
  const api = window.fastWindow
  const STORAGE_KEY = 'data'
  const VERSION = 2

  const state = {
    loading: true,
    sending: false,
    modal: '',
    sideTab: 'roles', // roles | chats
    models: { loading: false, error: '', items: [] },
    draft: {
      input: '',
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

  function now() {
    return Date.now()
  }

  function uid(prefix) {
    return `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
  }

  function esc(s) {
    return String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
    )
  }

  function trimSlash(s) {
    return String(s || '').replace(/\/+$/g, '')
  }

  function isHttpBaseUrl(s) {
    const t = String(s || '').trim().toLowerCase()
    return t.startsWith('http://') || t.startsWith('https://')
  }

  function clampTemp(v) {
    const n = Number(v)
    if (!isFinite(n)) return 0.7
    return Math.max(0, Math.min(2, n))
  }

  function defaultData() {
    const pid = uid('p')
    const rid = uid('r')
    const cid = uid('c')
    return {
      version: VERSION,
      settings: {
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
  function ensureRenderer() {
    if (rendererPromise) return rendererPromise
    rendererPromise = (async () => {
      try {
        await loadScriptOnce('https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js', 'marked')
      } catch (_) {}
      try {
        await loadScriptOnce('https://cdn.jsdelivr.net/npm/dompurify@3.0.11/dist/purify.min.js', 'DOMPurify')
      } catch (_) {}
      try {
        loadCssOnce('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css', 'katex-css')
        await loadScriptOnce('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js', 'katex')
        await loadScriptOnce('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js', 'renderMathInElement')
      } catch (_) {}
    })()
    return rendererPromise
  }

  function sanitizeHtml(html) {
    const raw = String(html || '')
    if (window.DOMPurify && window.DOMPurify.sanitize) {
      try {
        return window.DOMPurify.sanitize(raw, {
          FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
          FORBID_ATTR: ['style'],
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
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
      'HR',
    ])

    function isSafeHref(href) {
      const s = String(href || '').trim().toLowerCase()
      return s.startsWith('http://') || s.startsWith('https://') || s.startsWith('mailto:')
    }

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
        if (name.startsWith('on') || name === 'style') el.removeAttribute(a.name)
        else if (name === 'class') continue
        else if (name.startsWith('data-')) continue
        else if (tag === 'A' && (name === 'href' || name === 'target' || name === 'rel' || name === 'title')) continue
        else el.removeAttribute(a.name)
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

  function renderAssistantInto(el, text) {
    const raw = String(text || '')
    let html = ''

    const pre = preprocessMathBlocks(raw)

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

  async function sendChat() {
    if (state.sending || state.loading || !state.data) return

    const role = activeRole()
    const chat = activeChat()
    if (!role || !chat) return
    ensureRoleDefaults(role)

    const input = String(state.draft.input || '').trim()
    if (!input) return api.ui?.showToast?.('输入不能为空')

    const providerId = String(role.modelRef?.providerId || '')
    const modelId = String(role.modelRef?.modelId || '').trim()
    const p = getProvider(providerId)
    if (!p) return api.ui?.showToast?.('未找到该供应商')

    const baseUrl = trimSlash(p.baseUrl || '')
    const apiKey = String(p.apiKey || '').trim()

    if (!isHttpBaseUrl(baseUrl)) return api.ui?.showToast?.('请在供应商设置里配置 Base URL（http/https）')
    if (!apiKey) return api.ui?.showToast?.('请在供应商设置里配置 API Key')
    if (!modelId) return api.ui?.showToast?.('请在角色设置里选择模型（供应商 + 模型ID）')

    const wasEmpty = !Array.isArray(chat.messages) || chat.messages.length === 0
    chat.messages.push({ id: uid('m'), role: 'user', content: input, createdAt: now() })
    chat.updatedAt = now()
    if (wasEmpty && String(chat.title || '') === '新聊天') {
      const t = input.replace(/\s+/g, ' ').trim()
      chat.title = t.length > 16 ? t.slice(0, 16) + '…' : t || '新聊天'
    }
    state.draft.input = ''
    state.sending = true
    render()

    try {
      const sys = String(role.systemPrompt || '').trim()
      const history = limitHistory(chat.messages, 40)
      const messages = []
      if (sys) messages.push({ role: 'system', content: sys })
      for (const m of history) messages.push({ role: m.role, content: String(m.content || '') })

      const r = await api.net.request({
        method: 'POST',
        url: `${baseUrl}/chat/completions`,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: modelId, messages, temperature: clampTemp(role.temperature), stream: false }),
        timeoutMs: 120000,
      })

      const status = Number(r?.status || 0)
      const bodyText = String(r?.body || '')
      const json = JSON.parse(bodyText || '{}')
      if (status < 200 || status >= 300) throw new Error(json?.error?.message || bodyText || `HTTP ${status}`)

      const out = json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text ?? json?.output_text ?? ''
      chat.messages.push({ id: uid('m'), role: 'assistant', content: String(out || ''), createdAt: now() })
      chat.updatedAt = now()
      await save()
    } catch (e) {
      api.ui?.showToast?.(String(e?.message || e || '请求失败'))
    } finally {
      state.sending = false
      render()
      scrollToBottomSoon()
    }
  }

  const css = `
  :root{--bg:#fff;--card:#fff;--muted:#6b7280;--text:#111827;--line:#e5e7eb;--pri:#2563eb;--bad:#dc2626;--ok:#16a34a;--r:12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;}
  *{box-sizing:border-box;}html,body{height:100%;}body{margin:0;background:var(--bg);color:var(--text);}
  .wrap{height:100vh;display:flex;flex-direction:column;}
  .top{height:48px;display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:1px solid var(--line);background:#fff;}
  .title{font-weight:900;font-size:13px;letter-spacing:0.3px;margin-right:auto;}
  .btn{height:32px;padding:0 10px;border-radius:10px;border:1px solid var(--line);background:#fff;color:var(--text);cursor:pointer;font-size:12px;}
  .btn.pri{border-color:rgba(37,99,235,.25);background:rgba(37,99,235,.08);color:var(--pri);} .btn.bad{border-color:rgba(220,38,38,.25);background:rgba(220,38,38,.06);color:var(--bad);} .btn.ok{border-color:rgba(22,163,74,.25);background:rgba(22,163,74,.08);color:var(--ok);} .btn:disabled{opacity:.6;cursor:not-allowed;}
  .content{flex:1;min-height:0;display:flex;}
  .side{width:240px;border-right:1px solid var(--line);padding:10px;overflow:auto;}
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
  .chat{flex:1;min-height:0;overflow:auto;padding:12px;background:#fafafa;}
  .composer{border-top:1px solid var(--line);padding:10px;display:flex;gap:8px;align-items:flex-end;background:#fff;}
  .ta{flex:1;min-height:42px;max-height:160px;resize:vertical;border:1px solid var(--line);border-radius:12px;padding:9px 10px;font-size:12px;outline:none;}
  .msg{display:flex;gap:8px;margin-bottom:10px;} .bubble{max-width:880px;border:1px solid var(--line);border-radius:12px;padding:10px;background:#fff;box-shadow:0 6px 18px rgba(17,24,39,.06);} .msg.user{justify-content:flex-end;} .msg.user .bubble{background:rgba(37,99,235,.06);border-color:rgba(37,99,235,.18);}
  .msgHead{display:flex;align-items:center;gap:8px;margin-bottom:6px;} .msgRole{font-weight:900;font-size:12px;} .msgTime{font-size:11px;color:var(--muted);margin-left:auto;} .msgActions{display:flex;gap:6px;}
  .mini{height:26px;padding:0 8px;border-radius:10px;border:1px solid var(--line);background:#fff;cursor:pointer;font-size:12px;}
  .prose{font-size:12px;line-height:1.65;word-break:break-word;} .prose pre{overflow:auto;padding:10px;background:#0b1220;color:#e5e7eb;border-radius:10px;border:1px solid rgba(255,255,255,.08);} .prose code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;}
  .prose p{margin:8px 0;} .prose ul,.prose ol{margin:8px 0 8px 18px;} .prose blockquote{margin:8px 0;padding:8px 10px;border-left:3px solid rgba(37,99,235,.35);background:rgba(37,99,235,.04);border-radius:10px;} .prose hr{border:0;border-top:1px solid var(--line);margin:10px 0;} .math-block{margin:8px 0;overflow-x:auto;}
  .overlay{position:fixed;inset:0;background:rgba(17,24,39,.18);display:flex;align-items:center;justify-content:center;padding:12px;}
  .modal{width:min(760px,100%);max-height:calc(100vh - 24px);overflow:auto;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;box-shadow:0 10px 30px rgba(17,24,39,.12);}
  .card{border:1px solid var(--line);border-radius:12px;padding:10px;background:#fff;} .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;} .hr{height:1px;background:var(--line);margin:10px 0;}
  .field{width:100%;border:1px solid var(--line);background:#fff;color:var(--text);border-radius:10px;padding:9px 10px;font-size:12px;outline:none;} .field.sm{width:auto;min-width:180px;}
  `

  function mount() {
    document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`)
    document.body.innerHTML = `
      <div class="wrap">
        <div class="top" data-area="top"></div>
        <div class="content">
          <div class="side" data-area="side"></div>
          <div class="main">
            <div class="chat" data-area="chat"></div>
            <div class="composer" data-area="composer"></div>
          </div>
        </div>
        <div data-area="modal"></div>
      </div>
    `

    document.body.addEventListener('click', onClick)
    document.body.addEventListener('input', onInput)
    document.body.addEventListener('change', onChange)
    document.body.addEventListener('keydown', onKeyDown)
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
    const el = document.querySelector('[data-area="top"]')
    if (!(el instanceof HTMLElement)) return
    el.innerHTML = `
      <div class="title">💬 AI 聊天</div>
      <button class="btn" data-act="open-providers">供应商</button>
      <button class="btn pri" data-act="new-role">新角色</button>
      <button class="btn pri" data-act="new-chat">新建聊天</button>
      <button class="btn" data-act="edit-role">角色设置</button>
    `
  }

  function renderSide() {
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
          const time = fmtTime(c.updatedAt || c.createdAt)
          return `
            <div class="chatItem" data-act="pick-chat" data-id="${esc(c.id)}" data-active="${on}">
              <div class="chatTop">
                <div class="chatTitle">${esc(String(c.title || '新聊天'))}</div>
                <div class="sp"></div>
                <div class="chatTime">${esc(time)}</div>
              </div>
              <div class="chatText">${esc(who)}：${esc(snippet || '(空)')}</div>
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
        const body = isUser
          ? `<div class="prose">${esc(String(m.content || '')).replace(/\n/g, '<br />')}</div>`
          : `<div class="prose" data-render-assistant="1" data-mid="${esc(m.id)}"></div>`
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
      renderAssistantInto(h, String(msg?.content || ''))
    }
  }

  function renderComposer() {
    const el = document.querySelector('[data-area="composer"]')
    if (!(el instanceof HTMLElement)) return
    const disabled = state.loading || state.sending || !activeRole()
    el.innerHTML = `
      <textarea class="ta" data-bind="input" placeholder="输入消息…（Enter 发送 / Shift+Enter 换行）" ${disabled ? 'disabled' : ''}>${esc(
      state.draft.input || '',
    )}</textarea>
      <button class="btn pri" data-act="send" ${disabled ? 'disabled' : ''}>${state.sending ? '发送中…' : '发送'}</button>
    `
  }

  function renderModal() {
    const el = document.querySelector('[data-area="modal"]')
    if (!(el instanceof HTMLElement)) return
    if (!state.modal) return (el.innerHTML = '')

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
    renderTop()
    renderSide()
    renderChat()
    renderComposer()
    renderModal()
  }

  function scrollToBottomSoon() {
    const el = document.querySelector('[data-area="chat"]')
    if (!(el instanceof HTMLElement)) return
    requestAnimationFrame(() => {
      try {
        el.scrollTop = el.scrollHeight
      } catch (_) {}
    })
  }

  function closeModal() {
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
    const t = e?.target
    if (!(t instanceof HTMLElement)) return
    const act = t.getAttribute('data-act') || ''
    if (!act) return

    if (act === 'side-tab') {
      const tab = String(t.getAttribute('data-tab') || '')
      state.sideTab = tab === 'chats' ? 'chats' : 'roles'
      render()
      return
    }

    if (act === 'close-modal') {
      const stop = t.getAttribute('data-stop')
      if (stop === '1') return
      closeModal()
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

  async function init() {
    await ensureRenderer().catch(() => {})
    await load()
    mount()
    render()
    scrollToBottomSoon()
  }

  init()
})()
