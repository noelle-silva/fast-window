// ai-once (iframe sandbox)
;(function () {
  const api = window.fastWindow
  const STORAGE_KEY = 'data'
  const VERSION = 2

  const state = {
    loading: true,
    route: { name: 'list', spaceId: '' },
    modal: '',
    menuSpaceId: '',
    tplEditingIds: [],
    tplEditors: {},
    tplNewIds: [],
    models: [],
    modelsLoading: false,
    modelsError: '',
    sending: false,
    draft: {
      baseUrl: '',
      apiKey: '',
      providerName: '',
      activeProviderId: '',
      spaceName: '',
      templateName: '',
      templatePrompt: '',
      input: '',
      output: '',
      error: '',
      model: '',
      customModel: '',
      templateId: '',
      editSpaceId: '',
    },
    data: null,
  }

  const css = `
    :root{
      --bg:#ffffff; --card:#ffffff; --muted:#6b7280;
      --text:#111827; --line:#e5e7eb; --pri:#2563eb; --bad:#dc2626; --ok:#16a34a;
      --r:12px;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    }
    *{ box-sizing:border-box; }
    html,body{ height:100%; }
    body{ margin:0; background:var(--bg); color:var(--text); }
    .wrap{ height:100vh; display:flex; flex-direction:column; }
    .top{ height:48px; display:flex; align-items:center; gap:8px; padding:0 10px; border-bottom:1px solid var(--line); background:#ffffff; }
    .title{ font-weight:900; font-size:13px; letter-spacing:0.3px; margin-right:auto; }
    .btn{ height:32px; padding:0 10px; border-radius:10px; border:1px solid var(--line); background:#ffffff; color:var(--text); cursor:pointer; font-size:12px; }
    .btn.pri{ border-color:rgba(37,99,235,0.25); background:rgba(37,99,235,0.08); color:var(--pri); }
    .btn.ok{ border-color:rgba(22,163,74,0.25); background:rgba(22,163,74,0.08); color:var(--ok); }
    .btn.bad{ border-color:rgba(220,38,38,0.25); background:rgba(220,38,38,0.06); color:var(--bad); }
    .btn:disabled{ opacity:0.6; cursor:not-allowed; }
    .content{ flex:1; overflow:auto; padding:12px; }
    .grid{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
    @media (max-width:760px){ .grid{ grid-template-columns:1fr; } }
    .card{ background:var(--card); border:1px solid var(--line); border-radius:var(--r); padding:12px; box-shadow: 0 8px 24px rgba(17,24,39,0.06); }
    .spaceCard{ cursor:pointer; }
    .spaceCard:hover{ border-color: rgba(37,99,235,0.35); box-shadow: 0 10px 26px rgba(37,99,235,0.10); }
    .spaceCard:focus{ outline:2px solid rgba(37,99,235,0.35); outline-offset:2px; }
    .row{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .sp{ margin-left:auto; }
    .meta{ font-size:12px; color:var(--muted); margin-top:6px; }
    .field{ width:100%; border:1px solid var(--line); background:#ffffff; color:var(--text); border-radius:10px; padding:9px 10px; font-size:12px; outline:none; }
    .field.sm{ width:auto; min-width: 180px; }
    .ta{ resize:none; }
    .split{ display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; }
    @media (max-width:860px){ .split{ grid-template-columns:1fr; } }
    .mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .pane{ display:flex; flex-direction:column; min-height: calc(100vh - 48px - 24px); }
    .grow{ flex:1; min-height:0; }
    .out{ white-space:pre-wrap; word-break:break-word; border:1px solid var(--line); border-radius:10px; padding:10px; background:#f9fafb; font-size:12px; line-height:1.65; flex:1; min-height:0; overflow:auto; }
    .empty{ text-align:center; color:var(--muted); padding:24px 0; font-size:12px; }
    .overlay{ position:fixed; inset:0; background:rgba(17,24,39,0.18); display:flex; align-items:center; justify-content:center; padding:12px; }
    .modal{ width:min(680px,100%); max-height: calc(100vh - 24px); overflow:auto; background:var(--card); border:1px solid var(--line); border-radius:14px; padding:12px; box-shadow: 0 10px 30px rgba(17,24,39,0.12); }
    .hr{ height:1px; background:var(--line); margin:10px 0; }
    .iconBtn{ width:32px; height:32px; padding:0; border-radius:10px; border:1px solid var(--line); background:#ffffff; color:var(--text); cursor:pointer; font-size:18px; line-height:1; display:inline-flex; align-items:center; justify-content:center; }
    .menuWrap{ position:relative; }
    .menu{ position:absolute; right:0; top:38px; min-width:140px; background:var(--card); border:1px solid var(--line); border-radius:12px; box-shadow: 0 14px 40px rgba(17,24,39,0.16); padding:6px; display:flex; flex-direction:column; gap:6px; z-index:10; }
    .menuItem{ height:34px; width:100%; border-radius:10px; border:1px solid var(--line); background:#ffffff; cursor:pointer; font-size:12px; text-align:left; padding:0 10px; }
    .menuItem.bad{ border-color:rgba(220,38,38,0.25); background:rgba(220,38,38,0.06); color:var(--bad); }
  `

  function esc(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;')
  }

  function now() {
    return Date.now()
  }

  function id(prefix) {
    return `${prefix}-${now()}-${Math.random().toString(16).slice(2)}`
  }

  function trimSlash(s) {
    return String(s || '').trim().replace(/\/+$/, '')
  }

  function isHttpBaseUrl(s) {
    const raw = String(s || '').trim()
    try {
      const u = new URL(raw)
      return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.host
    } catch (_) {
      return false
    }
  }

  function defaultData() {
    const sid = id('space')
    const tid = id('tpl')
    const pid = id('prov')
    return {
      version: VERSION,
      settings: {
        activeProviderId: pid,
        providers: [{ id: pid, name: '默认供应商', baseUrl: 'https://api.openai.com/v1', apiKey: '', modelsCache: { items: [], fetchedAt: 0 } }],
      },
      spaces: [
        {
          id: sid,
          name: '默认空间',
          createdAt: now(),
          updatedAt: now(),
          defaultModelByProvider: {},
          activeTemplateId: tid,
          templates: [{ id: tid, name: '默认', systemPrompt: '你是一个严谨、直接、可执行的助手。' }],
        },
      ],
    }
  }

  function migrateV1ToV2(v1) {
    const baseUrl = trimSlash(v1?.settings?.baseUrl || 'https://api.openai.com/v1')
    const apiKey = String(v1?.settings?.apiKey || '')
    const cache = v1?.settings?.modelsCache && typeof v1.settings.modelsCache === 'object' ? v1.settings.modelsCache : null
    const items = Array.isArray(cache?.items) ? cache.items : []
    const fetchedAt = Number(cache?.fetchedAt || 0)

    const pid = id('prov')
    const out = defaultData()
    out.version = VERSION
    out.settings = {
      activeProviderId: pid,
      providers: [{ id: pid, name: '默认供应商', baseUrl, apiKey, modelsCache: { items, fetchedAt } }],
    }

    if (Array.isArray(v1?.spaces) && v1.spaces.length) {
      out.spaces = v1.spaces
        .filter((s) => s && typeof s === 'object' && typeof s.id === 'string')
        .map((s) => {
          const sid = String(s.id || id('space'))
          const tpls = Array.isArray(s.templates) ? s.templates : []
          const normTpls = tpls
            .filter((t) => t && typeof t === 'object' && typeof t.id === 'string')
            .map((t) => ({ id: String(t.id), name: String(t.name || '模板'), systemPrompt: String(t.systemPrompt || '') }))
          const first = normTpls[0] || { id: id('tpl'), name: '默认', systemPrompt: '' }
          if (!normTpls.length) normTpls.push(first)

          const dm = String(s.defaultModel || '')
          const dmMap = {}
          if (dm) dmMap[pid] = dm
          return {
            id: sid,
            name: String(s.name || '空间'),
            createdAt: Number(s.createdAt || now()),
            updatedAt: Number(s.updatedAt || now()),
            defaultModelByProvider: dmMap,
            activeTemplateId: String(s.activeTemplateId || first.id),
            templates: normTpls,
          }
        })
      if (!out.spaces.length) out.spaces = defaultData().spaces
    }
    return out
  }

  function normalizeData(raw) {
    const d = raw && typeof raw === 'object' ? raw : defaultData()
    if (d.version === 1) return migrateV1ToV2(d)
    if (d.version !== VERSION) return defaultData()

    d.settings ??= defaultData().settings
    if (!Array.isArray(d.settings.providers) || d.settings.providers.length === 0) d.settings.providers = defaultData().settings.providers
    for (const p of d.settings.providers) {
      if (!p || typeof p !== 'object') continue
      p.id = String(p.id || id('prov'))
      p.name = String(p.name || '供应商')
      p.baseUrl = trimSlash(p.baseUrl || 'https://api.openai.com/v1')
      p.apiKey = String(p.apiKey || '')
      p.modelsCache ??= { items: [], fetchedAt: 0 }
      if (!Array.isArray(p.modelsCache.items)) p.modelsCache.items = []
      p.modelsCache.fetchedAt = Number(p.modelsCache.fetchedAt || 0)
    }
    if (!d.settings.activeProviderId || !d.settings.providers.some((p) => p.id === d.settings.activeProviderId)) {
      d.settings.activeProviderId = String(d.settings.providers[0].id)
    }

    if (!Array.isArray(d.spaces) || d.spaces.length === 0) d.spaces = defaultData().spaces
    for (const s of d.spaces) {
      if (!s || typeof s !== 'object') continue
      s.id = String(s.id || id('space'))
      s.name = String(s.name || '空间')
      s.defaultModelByProvider ??= {}
      s.createdAt = Number(s.createdAt || now())
      s.updatedAt = Number(s.updatedAt || now())
      if (!Array.isArray(s.templates) || s.templates.length === 0) {
        const tid = id('tpl')
        s.templates = [{ id: tid, name: '默认', systemPrompt: '' }]
        s.activeTemplateId = tid
      }
      for (const t of s.templates) {
        if (!t || typeof t !== 'object') continue
        t.id = String(t.id || id('tpl'))
        t.name = String(t.name || '模板')
        t.systemPrompt = String(t.systemPrompt || '')
      }
      if (!s.activeTemplateId || !s.templates.some((t) => t.id === s.activeTemplateId)) s.activeTemplateId = s.templates[0].id
    }
    return d
  }

  function activeProvider() {
    const d = state.data
    if (!d) return null
    const pid = String(d.settings?.activeProviderId || '')
    const ps = Array.isArray(d.settings?.providers) ? d.settings.providers : []
    return ps.find((p) => p && p.id === pid) || ps[0] || null
  }

  function activeProviderId() {
    const p = activeProvider()
    return String(p?.id || '')
  }

  function activeProviderName() {
    const p = activeProvider()
    return String(p?.name || '')
  }

  function currentModel(space) {
    const pid = activeProviderId()
    if (!space || !pid) return ''
    const m = space.defaultModelByProvider && typeof space.defaultModelByProvider === 'object' ? space.defaultModelByProvider[pid] : ''
    return String(m || '')
  }

  function getSpace(spaceId) {
    const d = state.data
    if (!d || !Array.isArray(d.spaces)) return null
    return d.spaces.find((s) => s && s.id === spaceId) || null
  }

  function activeSpace() {
    if (state.route.name !== 'space') return null
    return getSpace(state.route.spaceId)
  }

  function activeTemplate(space) {
    if (!space) return null
    return space.templates.find((t) => t.id === space.activeTemplateId) || space.templates[0] || null
  }

  async function save() {
    if (!state.data) return
    try {
      await api.storage.set(STORAGE_KEY, state.data)
    } catch (_) {}
  }

  async function load() {
    try {
      const raw = await api.storage.get(STORAGE_KEY)
      state.data = normalizeData(raw)
      await save()
      const p = activeProvider()
      const cache = p?.modelsCache
      if (Array.isArray(cache?.items) && cache.items.length) state.models = cache.items.slice(0, 200)
    } catch (_) {
      state.data = defaultData()
      try {
        await save()
      } catch (_) {}
    }
    state.loading = false
  }

  async function refreshModels(force) {
    if (!state.data) return
    const p = activeProvider()
    const baseUrl = trimSlash(p?.baseUrl || '')
    const apiKey = String(p?.apiKey || '').trim()
    if (!baseUrl || !isHttpBaseUrl(baseUrl)) {
      state.modelsError = '未配置 Base URL'
      render()
      return
    }
    if (!apiKey) {
      state.modelsError = '未配置 API Key'
      render()
      return
    }
    const cache = p?.modelsCache || { items: [], fetchedAt: 0 }
    const age = now() - Number(cache.fetchedAt || 0)
    if (!force && Array.isArray(cache.items) && cache.items.length && age < 5 * 60 * 1000) {
      state.models = cache.items.slice(0, 200)
      state.modelsError = ''
      render()
      return
    }
    state.modelsLoading = true
    state.modelsError = ''
    render()
    try {
      let status = 0
      let bodyText = ''
      if (!api.net?.request) throw new Error('宿主未提供 net.request（需要升级应用）')
      const r = await api.net.request({
        method: 'GET',
        url: `${baseUrl}/models`,
        headers: { Authorization: `Bearer ${apiKey}` },
        timeoutMs: 20000,
      })
      status = Number(r?.status || 0)
      bodyText = String(r?.body || '')

      const json = JSON.parse(bodyText || '{}')
      if (status < 200 || status >= 300) throw new Error(json?.error?.message || bodyText || `HTTP ${status}`)
      const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : null
      if (!list) throw new Error('models 响应格式不支持（期望 data[] 或 models[]）')
      const ids = list
        .map((m) => (m && typeof m.id === 'string' ? m.id : ''))
        .filter((x) => !!x)
        .slice(0, 500)
        .sort((a, b) => String(a).localeCompare(String(b)))
      state.models = ids
      if (p) p.modelsCache = { items: ids, fetchedAt: now() }
      await save()
      state.modelsError = ''
      api.ui?.showToast?.(`模型已刷新（${ids.length}）`)
    } catch (e) {
      state.modelsError = String(e?.message || e || '获取模型失败')
      api.ui?.showToast?.(state.modelsError)
    } finally {
      state.modelsLoading = false
      render()
    }
  }

  function resolveModel(space) {
    const pick = String(state.draft.model || currentModel(space) || '').trim()
    if (pick === '__custom__') return String(state.draft.customModel || '').trim()
    return pick
  }

  async function sendOnce() {
    if (state.sending || !state.data) return
    const space = activeSpace()
    if (!space) return

    const p = activeProvider()
    const pid = String(p?.id || '')
    const baseUrl = trimSlash(p?.baseUrl || '')
    const apiKey = String(p?.apiKey || '').trim()
    if (!isHttpBaseUrl(baseUrl)) return api.ui?.showToast?.('请先在设置里配置 Base URL（http:// 或 https://）')
    if (!apiKey) return api.ui?.showToast?.('请先在设置里配置 API Key')

    const userInput = String(state.draft.input || '').trim()
    if (!userInput) return api.ui?.showToast?.('输入不能为空')

    const model = resolveModel(space)
    if (!model) return api.ui?.showToast?.('请选择/填写模型')

    const tpl = activeTemplate(space)
    const sys = String(tpl?.systemPrompt || '').trim()
    const messages = []
    if (sys) messages.push({ role: 'system', content: sys })
    messages.push({ role: 'user', content: userInput })

    state.sending = true
    state.draft.error = ''
    state.draft.output = ''
    render()
    try {
      let status = 0
      let bodyText = ''
      if (!api.net?.request) throw new Error('宿主未提供 net.request（需要升级应用）')
      const r = await api.net.request({
        method: 'POST',
        url: `${baseUrl}/chat/completions`,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, temperature: 0.2, stream: false }),
        timeoutMs: 60000,
      })
      status = Number(r?.status || 0)
      bodyText = String(r?.body || '')

      const json = JSON.parse(bodyText || '{}')
      if (status < 200 || status >= 300) throw new Error(json?.error?.message || bodyText || `HTTP ${status}`)
      const out = json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text ?? ''
      if (!out) throw new Error('响应为空（choices[0].message.content 不存在）')
      state.draft.output = String(out)
      if (pid) {
        space.defaultModelByProvider ??= {}
        space.defaultModelByProvider[pid] = model
      }
      space.updatedAt = now()
      await save()
    } catch (e) {
      state.draft.error = String(e?.message || e || '请求失败')
      api.ui?.showToast?.(state.draft.error)
    } finally {
      state.sending = false
      render()
    }
  }

  async function copyOutput() {
    const out = String(state.draft.output || '').trim()
    if (!out) return
    try {
      await api.clipboard.writeText(out)
      api.ui?.showToast?.('已复制')
    } catch (_) {
      api.ui?.showToast?.('复制失败')
    }
  }

  async function createSpace(name) {
    if (!state.data) return
    const n = String(name || '').trim()
    if (!n) return
    const sid = id('space')
    const tid = id('tpl')
    state.data.spaces.unshift({
      id: sid,
      name: n,
      createdAt: now(),
      updatedAt: now(),
      defaultModel: '',
      activeTemplateId: tid,
      templates: [{ id: tid, name: '默认', systemPrompt: '' }],
    })
    await save()
    state.route = { name: 'space', spaceId: sid }
    state.modal = ''
    render()
  }

  async function renameSpace(spaceId, name) {
    if (!state.data) return
    const s = getSpace(spaceId)
    if (!s) return
    const n = String(name || '').trim()
    if (!n) return api.ui?.showToast?.('空间名称不能为空')
    s.name = n
    s.updatedAt = now()
    await save()
    render()
  }

  async function deleteSpace(spaceId) {
    if (!state.data) return
    const s = getSpace(spaceId)
    if (!s) return
    if (!confirm(`删除空间「${s.name}」？`)) return
    state.data.spaces = state.data.spaces.filter((x) => x.id !== spaceId)
    if (state.data.spaces.length === 0) state.data.spaces = defaultData().spaces
    state.route = { name: 'list', spaceId: '' }
    await save()
    render()
  }

  function goSpace(spaceId) {
    const id = String(spaceId || '')
    if (!id) return
    state.menuSpaceId = ''
    state.route = { name: 'space', spaceId: id }
    state.draft.input = ''
    state.draft.output = ''
    state.draft.error = ''
    state.draft.model = ''
    state.draft.customModel = ''
    render()
  }

  function openEditSpace(spaceId) {
    const id = String(spaceId || '')
    const s = id ? getSpace(id) : null
    if (!s) return
    state.menuSpaceId = ''
    state.modal = 'edit-space'
    state.draft.editSpaceId = id
    state.draft.spaceName = s.name
    render()
  }

  function isTplEditing(templateId) {
    return state.tplEditingIds.includes(templateId)
  }

  function closeTplEditor(templateId) {
    const tid = String(templateId || '')
    if (!tid) return
    state.tplEditingIds = state.tplEditingIds.filter((x) => x !== tid)
    state.tplNewIds = state.tplNewIds.filter((x) => x !== tid)
    if (state.tplEditors && typeof state.tplEditors === 'object') delete state.tplEditors[tid]
  }

  function openTplEditor(space, templateId, isNew) {
    if (!space) return
    const tid = String(templateId || '')
    if (!tid) return
    state.tplEditors ??= {}
    if (!state.tplEditors[tid]) {
      const t = isNew ? null : space.templates.find((x) => x && x.id === tid)
      state.tplEditors[tid] = {
        name: String(t?.name || ''),
        prompt: String(t?.systemPrompt || ''),
        isNew: !!isNew,
      }
    }
    if (!state.tplEditingIds.includes(tid)) state.tplEditingIds.push(tid)
  }

  function beginEditTemplate(space, templateId) {
    if (!space) return
    const tpl = templateId ? space.templates.find((t) => t.id === templateId) : null
    state.draft.templateId = tpl ? tpl.id : ''
    state.draft.templateName = tpl ? tpl.name : ''
    state.draft.templatePrompt = tpl ? tpl.systemPrompt : ''
  }

  async function saveTemplate(space, templateId, name, prompt) {
    if (!space) return
    const n = String(name || '').trim()
    if (!n) return api.ui?.showToast?.('模板名称不能为空')
    const p = String(prompt || '')
    const id2 = templateId || id('tpl')
    const idx = space.templates.findIndex((t) => t.id === id2)
    const next = { id: id2, name: n, systemPrompt: p }
    if (idx >= 0) space.templates[idx] = next
    else space.templates.unshift(next)
    space.activeTemplateId = id2
    space.updatedAt = now()
    await save()
    render()
  }

  async function deleteTemplate(space, templateId) {
    if (!space) return
    if (space.templates.length <= 1) return api.ui?.showToast?.('至少保留一个模板')
    const tpl = space.templates.find((t) => t.id === templateId)
    if (!confirm(`删除模板「${tpl ? tpl.name : ''}」？`)) return
    space.templates = space.templates.filter((t) => t.id !== templateId)
    if (!space.templates.some((t) => t.id === space.activeTemplateId)) space.activeTemplateId = space.templates[0].id
    space.updatedAt = now()
    await save()
    render()
  }

  function mount() {
    const root = document.getElementById('app') || document.body
    root.innerHTML = `
      <style>${css}</style>
      <div class="wrap">
        <div class="top" data-area="top"></div>
        <div class="content" data-area="content"></div>
        <div data-area="modal"></div>
      </div>
    `

    root.addEventListener('click', async (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const act = t.getAttribute('data-act') || ''

      let closedMenu = false
      if (!act && state.route.name === 'list' && state.menuSpaceId) {
        const inMenu = !!t.closest('[data-space-menu="1"]')
        if (!inMenu) {
          state.menuSpaceId = ''
          closedMenu = true
        }
      }

      if (!act && state.route.name === 'list') {
        if (t.closest('[data-space-menu="1"]')) return
        const card = t.closest('[data-space-card="1"]')
        if (card instanceof HTMLElement) {
          goSpace(card.getAttribute('data-id') || '')
          return
        }
      }

      if (closedMenu) {
        render()
        return
      }

      if (act === 'open-settings') {
        state.modal = 'settings'
        const p = activeProvider()
        state.draft.activeProviderId = String(p?.id || '')
        state.draft.providerName = String(p?.name || '')
        state.draft.baseUrl = String(p?.baseUrl || '')
        state.draft.apiKey = String(p?.apiKey || '')
        render()
        return
      }
      if (act === 'close-modal') {
        state.modal = ''
        render()
        return
      }
      if (act === 'save-settings') {
        if (!state.data) return
        const pid = String(state.data.settings.activeProviderId || '')
        const p = state.data.settings.providers.find((x) => x && x.id === pid)
        if (!p) return api.ui?.showToast?.('未选择供应商')
        const name = String(state.draft.providerName || '').trim() || '供应商'
        const baseUrl = trimSlash(state.draft.baseUrl)
        const apiKey = String(state.draft.apiKey || '').trim()
        if (!isHttpBaseUrl(baseUrl)) return api.ui?.showToast?.(`Base URL 无效：${baseUrl || '(空)'}（示例：http://192.168.123.111:9100/v1）`)
        p.name = name
        p.baseUrl = baseUrl
        p.apiKey = apiKey
        p.modelsCache = { items: [], fetchedAt: 0 }
        state.models = []
        state.modelsError = ''
        save()
        api.ui?.showToast?.('已保存（请手动刷新模型）')
        render()
        return
      }
      if (act === 'add-provider') {
        if (!state.data) return
        const pid = id('prov')
        state.data.settings.providers.unshift({ id: pid, name: '新供应商', baseUrl: 'http://', apiKey: '', modelsCache: { items: [], fetchedAt: 0 } })
        state.data.settings.activeProviderId = pid
        save()
        state.draft.activeProviderId = pid
        state.draft.providerName = '新供应商'
        state.draft.baseUrl = 'http://'
        state.draft.apiKey = ''
        state.models = []
        state.modelsError = ''
        render()
        return
      }
      if (act === 'delete-provider') {
        if (!state.data) return
        const pid = String(state.data.settings.activeProviderId || '')
        if (state.data.settings.providers.length <= 1) return api.ui?.showToast?.('至少保留一个供应商')
        const p = state.data.settings.providers.find((x) => x && x.id === pid)
        if (!confirm(`删除供应商「${p ? p.name : ''}」？`)) return
        state.data.settings.providers = state.data.settings.providers.filter((x) => x.id !== pid)
        state.data.settings.activeProviderId = String(state.data.settings.providers[0].id)
        save()
        const p2 = activeProvider()
        state.draft.activeProviderId = String(p2?.id || '')
        state.draft.providerName = String(p2?.name || '')
        state.draft.baseUrl = String(p2?.baseUrl || '')
        state.draft.apiKey = String(p2?.apiKey || '')
        state.models = []
        state.modelsError = ''
        render()
        return
      }
      if (act === 'refresh-models') {
        refreshModels(true)
        return
      }
      if (act === 'open-templates') {
        const s = activeSpace()
        if (!s) return
        state.modal = 'templates'
        state.tplEditingIds = []
        state.tplEditors = {}
        state.tplNewIds = []
        render()
        return
      }
      if (act === 'create-space') {
        state.modal = 'space'
        state.draft.spaceName = ''
        render()
        return
      }
      if (act === 'save-new-space') {
        createSpace(state.draft.spaceName)
        return
      }
      if (act === 'toggle-space-menu') {
        const id = t.getAttribute('data-id') || ''
        if (!id) return
        state.menuSpaceId = state.menuSpaceId === id ? '' : id
        render()
        return
      }
      if (act === 'edit-space') {
        const id = t.getAttribute('data-id') || ''
        if (!id) return
        openEditSpace(id)
        return
      }
      if (act === 'save-edit-space') {
        const id = String(state.draft.editSpaceId || '')
        if (!id) return
        const n = String(state.draft.spaceName || '').trim()
        if (!n) return api.ui?.showToast?.('空间名称不能为空')
        state.modal = ''
        renameSpace(id, n)
        return
      }
      if (act === 'open-space') {
        const id = t.getAttribute('data-id') || ''
        if (!id) return
        goSpace(id)
        return
      }
      if (act === 'space-back') {
        state.menuSpaceId = ''
        state.route = { name: 'list', spaceId: '' }
        state.draft.input = ''
        state.draft.output = ''
        state.draft.error = ''
        render()
        return
      }
      if (act === 'delete-space') {
        const id = t.getAttribute('data-id') || ''
        if (!id) return
        state.menuSpaceId = ''
        state.modal = ''
        deleteSpace(id)
        return
      }
      if (act === 'send') {
        sendOnce()
        return
      }
      if (act === 'copy-output') {
        copyOutput()
        return
      }
      if (act === 'set-template') {
        const s = activeSpace()
        if (!s) return
        const tid = t.getAttribute('data-id') || ''
        if (!tid) return
        s.activeTemplateId = tid
        s.updatedAt = now()
        save()
        render()
        return
      }
      if (act === 'edit-template') {
        const s = activeSpace()
        if (!s) return
        const tid = t.getAttribute('data-id') || ''
        if (!tid) return
        if (isTplEditing(tid)) closeTplEditor(tid)
        else openTplEditor(s, tid, false)
        render()
        return
      }
      if (act === 'new-template') {
        const s = activeSpace()
        if (!s) return
        const tid = id('tpl')
        state.tplNewIds.unshift(tid)
        openTplEditor(s, tid, true)
        render()
        return
      }
      if (act === 'save-template-inline') {
        const s = activeSpace()
        if (!s) return
        const tid = t.getAttribute('data-id') || ''
        if (!tid) return
        const ed = state.tplEditors && typeof state.tplEditors === 'object' ? state.tplEditors[tid] : null
        if (!ed) return
        const n = String(ed.name || '').trim()
        if (!n) return api.ui?.showToast?.('模板名称不能为空')
        const p = String(ed.prompt || '')
        closeTplEditor(tid)
        await saveTemplate(s, tid, n, p)
        return
      }
      if (act === 'close-template-editor') {
        const tid = t.getAttribute('data-id') || ''
        if (!tid) return
        closeTplEditor(tid)
        render()
        return
      }
      if (act === 'delete-template') {
        const s = activeSpace()
        if (!s) return
        const tid = t.getAttribute('data-id') || ''
        if (!tid) return
        if (state.tplNewIds.includes(tid)) {
          closeTplEditor(tid)
          render()
          return
        }
        closeTplEditor(tid)
        deleteTemplate(s, tid)
        return
      }
    })

    root.addEventListener('input', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const tid = t.getAttribute('data-tpl-id') || ''
      const tk = t.getAttribute('data-tpl-bind') || ''
      if (tid && tk) {
        if (!(t instanceof HTMLInputElement) && !(t instanceof HTMLTextAreaElement)) return
        state.tplEditors ??= {}
        state.tplEditors[tid] ??= { name: '', prompt: '', isNew: state.tplNewIds.includes(tid) }
        if (tk === 'name') state.tplEditors[tid].name = t.value
        if (tk === 'prompt') state.tplEditors[tid].prompt = t.value
        return
      }
      const k = t.getAttribute('data-bind') || ''
      if (!k) return
      const v = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement ? t.value : ''
      state.draft[k] = v
      if (k === 'customModel') {
        const s = activeSpace()
        if (!s) return
        if (String(state.draft.model || '') !== '__custom__') return
        const m = String(state.draft.customModel || '').trim()
        if (!m) return
        const pid = activeProviderId()
        if (pid) {
          s.defaultModelByProvider ??= {}
          s.defaultModelByProvider[pid] = m
        }
        s.updatedAt = now()
        save()
      }
    })

    root.addEventListener('change', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const k = t.getAttribute('data-bind') || ''
      if (!k) return
      // 这里只处理 <select>：避免 input/textarea 的 change 把值误写成空字符串
      if (!(t instanceof HTMLSelectElement)) return
      const v = t.value
      state.draft[k] = v
      if (k === 'activeProviderId') {
        if (!state.data) return
        const pid = String(v || '')
        if (!pid) return
        if (!state.data.settings.providers.some((p) => p && p.id === pid)) return
        state.data.settings.activeProviderId = pid
        save()
        const p = activeProvider()
        const cache = p?.modelsCache
        state.models = Array.isArray(cache?.items) ? cache.items.slice(0, 200) : []
        state.modelsError = ''
        state.draft.model = ''
        state.draft.customModel = ''
        if (state.modal === 'settings') {
          state.draft.providerName = String(p?.name || '')
          state.draft.baseUrl = String(p?.baseUrl || '')
          state.draft.apiKey = String(p?.apiKey || '')
        }
        render()
        return
      }
      if (k === 'model') {
        const s = activeSpace()
        if (!s) return
        if (String(state.draft.model || '') === '__custom__') {
          if (!String(state.draft.customModel || '').trim()) state.draft.customModel = String(currentModel(s) || '')
          render()
          return
        }
        const pid = activeProviderId()
        if (pid) {
          s.defaultModelByProvider ??= {}
          s.defaultModelByProvider[pid] = resolveModel(s)
        }
        s.updatedAt = now()
        save()
        render()
      }
      if (k === 'templateId') {
        const s = activeSpace()
        if (!s) return
        const tid = String(state.draft.templateId || '')
        if (!tid) return
        s.activeTemplateId = tid
        s.updatedAt = now()
        save()
        render()
      }
    })

    root.addEventListener('keydown', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (state.route.name === 'list' && t.getAttribute('data-space-card') === '1') {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          goSpace(t.getAttribute('data-id') || '')
        }
        return
      }
      if (t.getAttribute('data-act') !== 'user-input') return
      if (!(t instanceof HTMLTextAreaElement)) return
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        sendOnce()
      }
    })
  }

  function renderTop() {
    const el = document.querySelector('[data-area="top"]')
    if (!(el instanceof HTMLElement)) return
    if (state.route.name === 'list') {
      const ps = state.data ? state.data.settings.providers : []
      const pid = state.data ? String(state.data.settings.activeProviderId || '') : ''
      const pOptions = Array.isArray(ps)
        ? ps.map((p) => `<option value="${esc(p.id)}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')
        : ''
      const p = activeProvider()
      const info = p ? esc(trimSlash(p.baseUrl || '')) : ''
      el.innerHTML = `
        <div class="title">AI 一次性响应</div>
        <select class="field sm" data-bind="activeProviderId" title="当前生效供应商">${pOptions}</select>
        <div class="meta mono" title="${info}" style="margin:0">${info}</div>
        <div class="sp"></div>
        <button class="btn" data-act="open-settings">设置</button>
        <button class="btn pri" data-act="create-space">新建空间</button>
      `
      return
    }
    const s = activeSpace()
    const m = state.modelsLoading ? '模型：加载中' : state.modelsError ? '模型：不可用' : `模型：${state.models.length || '-'}`
    const ps = state.data ? state.data.settings.providers : []
    const pid = state.data ? String(state.data.settings.activeProviderId || '') : ''
    const pOptions = Array.isArray(ps)
      ? ps.map((p) => `<option value="${esc(p.id)}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')
      : ''
    const tplOptions = s
      ? s.templates
          .map((t) => `<option value="${esc(t.id)}" ${t.id === s.activeTemplateId ? 'selected' : ''}>${esc(t.name)}</option>`)
          .join('')
      : ''
    el.innerHTML = `
      <button class="btn" data-act="space-back">空间</button>
      <div class="title">${esc(s ? s.name : '')}</div>
      <select class="field sm" data-bind="activeProviderId" title="当前生效供应商">${pOptions}</select>
      <select class="field sm" data-bind="templateId" title="提示词模板">${tplOptions}</select>
      <button class="btn" data-act="open-templates">模板管理</button>
      <div class="meta" style="margin:0" title="${esc(state.modelsError || '')}">${esc(m)}</div>
      <button class="btn" data-act="refresh-models" ${state.modelsLoading ? 'disabled' : ''}>刷新模型</button>
      <div class="sp"></div>
    `
  }

  function renderList() {
    const el = document.querySelector('[data-area="content"]')
    if (!(el instanceof HTMLElement)) return
    if (!state.data) return
    const pid = activeProviderId()
    const spaces = state.data.spaces || []
    el.innerHTML = `
      <div class="grid">
        ${spaces
          .map((s) => {
            const model = String((s.defaultModelByProvider && typeof s.defaultModelByProvider === 'object' ? s.defaultModelByProvider[pid] : '') || '').trim() || '未设置'
            const tplCount = Array.isArray(s.templates) ? s.templates.length : 0
            const menuOn = state.menuSpaceId === s.id
            return `
              <div class="card spaceCard" data-space-card="1" data-id="${esc(s.id)}" role="button" tabindex="0" aria-label="进入空间：${esc(s.name)}">
                <div class="row">
                  <div class="title" style="margin:0">${esc(s.name)}</div>
                  <div class="sp"></div>
                  <div class="menuWrap" data-space-menu="1">
                    <button class="iconBtn" data-act="toggle-space-menu" data-id="${esc(s.id)}" aria-label="空间操作">⋯</button>
                    ${
                      menuOn
                        ? `
                          <div class="menu" data-space-menu="1">
                            <button class="menuItem" data-act="edit-space" data-id="${esc(s.id)}">编辑</button>
                            <button class="menuItem bad" data-act="delete-space" data-id="${esc(s.id)}">删除空间</button>
                          </div>
                        `
                        : ''
                    }
                  </div>
                </div>
                <div class="meta">默认模型：<span class="mono">${esc(model)}</span></div>
                <div class="meta">模板：${tplCount} 个</div>
              </div>
            `
          })
          .join('')}
      </div>
      <div class="empty" style="padding-top:14px">空间之间的模板与默认模型互相隔离；Ctrl/⌘ + Enter 发送。</div>
    `
  }

  function renderSpace() {
    const el = document.querySelector('[data-area="content"]')
    if (!(el instanceof HTMLElement)) return
    const s = activeSpace()
    if (!s) {
      el.innerHTML = `<div class="empty">空间不存在</div>`
      return
    }

    const models = state.models || []
    const cur = String(currentModel(s) || '').trim()
    const inList = cur && models.includes(cur)
    const customOn = String(state.draft.model || '') === '__custom__'
    const modelOptions = []
    if (cur && !inList) modelOptions.push(`<option value="${esc(cur)}" ${customOn ? '' : 'selected'}>当前：${esc(cur)}（不在列表）</option>`)
    for (const m of models) modelOptions.push(`<option value="${esc(m)}" ${!customOn && m === cur ? 'selected' : ''}>${esc(m)}</option>`)
    modelOptions.push(`<option value="__custom__" ${customOn ? 'selected' : ''}>手动输入…</option>`)
    const showCustom = (state.draft.model || '') === '__custom__'

    el.innerHTML = `
      <div class="split">
        <div class="card pane">
          <div class="row" style="margin-bottom:8px">
            <div class="meta" style="margin:0">模型</div>
            <select class="field" data-bind="model" style="flex:1; min-width: 220px">${modelOptions.join('')}</select>
            <button class="btn ok" data-act="send" ${state.sending ? 'disabled' : ''}>${state.sending ? '发送中…' : '发送'}</button>
          </div>
          ${showCustom ? `<input class="field mono" data-bind="customModel" placeholder="例如：gpt-4.1-mini / deepseek-chat" value="${esc(state.draft.customModel || cur)}" />` : ''}
          <textarea class="field mono grow ta" data-bind="input" data-act="user-input" placeholder="输入你的问题…（Ctrl/⌘ + Enter 发送）">${esc(state.draft.input || '')}</textarea>
          ${state.draft.error ? `<div class="meta" style="color:var(--bad)">${esc(state.draft.error)}</div>` : ''}
        </div>

        <div class="card pane">
          <div class="row">
            <div class="title" style="margin:0">输出</div>
            <div class="sp"></div>
            <button class="btn" data-act="copy-output" ${state.draft.output ? '' : 'disabled'}>复制</button>
          </div>
          <div class="out mono">${state.draft.output ? esc(state.draft.output) : '<span style="color:var(--muted)">等待输出…</span>'}</div>
        </div>
      </div>
    `
  }

  function renderModal() {
    const el = document.querySelector('[data-area="modal"]')
    if (!(el instanceof HTMLElement)) return
    if (!state.modal) {
      el.innerHTML = ''
      return
    }
    if (state.modal === 'settings') {
      const status = state.modelsLoading
        ? '模型：加载中…'
        : state.modelsError
          ? `模型：失败（${state.modelsError}）`
          : state.models.length
            ? `模型：${state.models.length}`
            : '模型：-'
      const ps = state.data ? state.data.settings.providers : []
      const pid = state.data ? String(state.data.settings.activeProviderId || '') : ''
      const pOptions = Array.isArray(ps)
        ? ps.map((p) => `<option value="${esc(p.id)}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')
        : ''
      el.innerHTML = `
        <div class="overlay" data-act="close-modal">
          <div class="modal">
            <div class="row">
              <div class="title" style="margin:0">连接设置（OpenAI 兼容）</div>
              <div class="sp"></div>
              <button class="btn" data-act="close-modal">关闭</button>
            </div>
            <div class="hr"></div>
            <div class="row" style="margin-bottom:8px">
              <div class="meta" style="margin:0">生效供应商</div>
              <select class="field sm" data-bind="activeProviderId">${pOptions}</select>
              <button class="btn" data-act="add-provider">新增</button>
              <button class="btn bad" data-act="delete-provider">删除</button>
            </div>
            <div class="meta">供应商名称</div>
            <input class="field" data-bind="providerName" placeholder="例如：OpenAI / DeepSeek / 本地网关" value="${esc(state.draft.providerName || '')}" />
            <div class="hr"></div>
            <div class="meta">Base URL</div>
            <input class="field mono" data-bind="baseUrl" placeholder="https://api.openai.com/v1" value="${esc(state.draft.baseUrl || '')}" />
            <div class="hr"></div>
            <div class="meta">API Key</div>
            <input class="field mono" type="password" data-bind="apiKey" placeholder="sk-..." value="${esc(state.draft.apiKey || '')}" />
            <div class="hr"></div>
            <div class="row">
              <button class="btn pri" data-act="save-settings" ${state.modelsLoading ? 'disabled' : ''}>保存</button>
              <button class="btn" data-act="refresh-models" ${state.modelsLoading ? 'disabled' : ''}>仅刷新模型</button>
              <div class="sp"></div>
              <div class="meta" style="margin:0">${esc(status)}</div>
            </div>
          </div>
        </div>
      `
      return
    }
    if (state.modal === 'space') {
      el.innerHTML = `
        <div class="overlay" data-act="close-modal">
          <div class="modal">
            <div class="row">
              <div class="title" style="margin:0">新建空间</div>
              <div class="sp"></div>
              <button class="btn" data-act="close-modal">关闭</button>
            </div>
            <div class="hr"></div>
            <input class="field" data-bind="spaceName" placeholder="例如：工作 / 写作 / 代码审查" value="${esc(state.draft.spaceName || '')}" />
            <div class="hr"></div>
            <div class="row">
              <button class="btn ok" data-act="save-new-space">保存</button>
              <div class="sp"></div>
              <div class="meta" style="margin:0">空间用于隔离模板与默认模型</div>
            </div>
          </div>
        </div>
      `
      return
    }
    if (state.modal === 'edit-space') {
      const id = String(state.draft.editSpaceId || '')
      const s = id ? getSpace(id) : null
      if (!s) {
        state.modal = ''
        el.innerHTML = ''
        return
      }
      el.innerHTML = `
        <div class="overlay" data-act="close-modal">
          <div class="modal">
            <div class="row">
              <div class="title" style="margin:0">编辑空间：${esc(s.name)}</div>
              <div class="sp"></div>
              <button class="btn" data-act="close-modal">关闭</button>
            </div>
            <div class="hr"></div>
            <div class="meta">名称</div>
            <input class="field" data-bind="spaceName" placeholder="输入空间名称…" value="${esc(state.draft.spaceName || '')}" />
            <div class="hr"></div>
            <div class="row">
              <button class="btn ok" data-act="save-edit-space">保存</button>
              <button class="btn bad" data-act="delete-space" data-id="${esc(s.id)}">删除空间</button>
              <div class="sp"></div>
              <div class="meta" style="margin:0">删除后不可恢复</div>
            </div>
          </div>
        </div>
      `
      return
    }
    if (state.modal === 'templates') {
      const s = activeSpace()
      if (!s) {
        state.modal = ''
        el.innerHTML = ''
        return
      }

      const eds = state.tplEditors && typeof state.tplEditors === 'object' ? state.tplEditors : {}
      const cards = []

      for (const tid of state.tplNewIds) {
        const open = isTplEditing(tid)
        const ed = eds[tid] || { name: '', prompt: '' }
        const snippet = String(ed.prompt || '').trim().slice(0, 120)
        cards.push(`
          <div class="card" style="padding:10px">
            <div class="row">
              <div class="title" style="margin:0">${esc(ed.name || '新建模板')}</div>
              <div class="sp"></div>
              <button class="btn ok" data-act="save-template-inline" data-id="${esc(tid)}">保存</button>
              <button class="btn" data-act="close-template-editor" data-id="${esc(tid)}">取消</button>
            </div>
            <div class="meta mono">${esc(snippet)}${String(ed.prompt || '').trim().length > 120 ? '…' : ''}</div>
            ${
              open
                ? `
                  <div class="hr"></div>
                  <div class="meta">名称</div>
                  <input class="field" data-tpl-id="${esc(tid)}" data-tpl-bind="name" placeholder="例如：总结 / 翻译 / 严格审阅" value="${esc(ed.name || '')}" />
                  <div class="hr"></div>
                  <div class="meta">System Prompt（仅本空间生效）</div>
                  <textarea class="field mono ta" data-tpl-id="${esc(tid)}" data-tpl-bind="prompt" placeholder="写入 system 提示词…" style="min-height:140px">${esc(ed.prompt || '')}</textarea>
                `
                : ''
            }
          </div>
        `)
      }

      for (const t of s.templates) {
        const on = t.id === s.activeTemplateId
        const head = on ? `（当前）` : ''
        const open = isTplEditing(t.id)
        const ed = eds[t.id] || { name: t.name, prompt: t.systemPrompt }
        const snippet = String(t.systemPrompt || '').trim().slice(0, 120)
        cards.push(`
          <div class="card" style="padding:10px">
            <div class="row">
              <div class="title" style="margin:0">${esc(t.name)} <span class="meta" style="margin:0">${esc(head)}</span></div>
              <div class="sp"></div>
              <button class="btn" data-act="set-template" data-id="${esc(t.id)}">设为当前</button>
              <button class="btn" data-act="edit-template" data-id="${esc(t.id)}">${open ? '收起' : '编辑'}</button>
              <button class="btn bad" data-act="delete-template" data-id="${esc(t.id)}">删除</button>
            </div>
            <div class="meta mono">${esc(snippet)}${String(t.systemPrompt || '').trim().length > 120 ? '…' : ''}</div>
            ${
              open
                ? `
                  <div class="hr"></div>
                  <div class="meta">名称</div>
                  <input class="field" data-tpl-id="${esc(t.id)}" data-tpl-bind="name" placeholder="例如：总结 / 翻译 / 严格审阅" value="${esc(ed.name || '')}" />
                  <div class="hr"></div>
                  <div class="meta">System Prompt（仅本空间生效）</div>
                  <textarea class="field mono ta" data-tpl-id="${esc(t.id)}" data-tpl-bind="prompt" placeholder="写入 system 提示词…" style="min-height:140px">${esc(ed.prompt || '')}</textarea>
                  <div class="hr"></div>
                  <div class="row">
                    <button class="btn ok" data-act="save-template-inline" data-id="${esc(t.id)}">保存</button>
                    <button class="btn" data-act="close-template-editor" data-id="${esc(t.id)}">收起</button>
                  </div>
                `
                : ''
            }
          </div>
        `)
      }

      const items = cards.join('')

      el.innerHTML = `
        <div class="overlay" data-act="close-modal">
          <div class="modal">
            <div class="row">
              <div class="title" style="margin:0">模板管理：${esc(s.name)}</div>
              <div class="sp"></div>
              <button class="btn" data-act="new-template">新建</button>
              <button class="btn" data-act="close-modal">关闭</button>
            </div>
            <div class="hr"></div>
            <div style="display:flex; flex-direction:column; gap:8px">${items || '<div class="empty">暂无模板</div>'}</div>
          </div>
        </div>
      `
      return
    }
    el.innerHTML = ''
  }

  function render() {
    renderTop()
    if (state.loading) {
      const el = document.querySelector('[data-area="content"]')
      if (el instanceof HTMLElement) el.innerHTML = `<div class="empty">加载中…</div>`
      renderModal()
      return
    }
    if (state.route.name === 'list') renderList()
    else renderSpace()
    renderModal()
  }

  async function init() {
    await load()
    mount()
    render()
  }

  init()
})()
