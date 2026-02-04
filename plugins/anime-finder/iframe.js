// anime-finder (iframe sandbox)
;(function () {
  const api = window.fastWindow

  const TRACE_MOE_API = 'https://api.trace.moe/search?cutBorders&anilistInfo'
  const MAX_UPLOAD_BYTES = 6 * 1024 * 1024
  const MAX_DIMENSION = 960

  const state = {
    busy: false,
    imageDataUrl: '',
    imageMime: '',
    imageName: '',
    result: null,
    error: '',
  }

  const styles = `
    :root{
      --bg:#FAFAFA;
      --surface:#FFFFFF;
      --text:#212121;
      --muted:#757575;
      --outline:#E0E0E0;
      --primary:#1976D2;
      --danger:#D32F2F;
      --shadow:0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);
    }
    *{box-sizing:border-box;}
    body{margin:0;background:var(--bg);color:var(--text);}
    a{color:var(--primary);text-decoration:none;}
    a:hover{text-decoration:underline;}
    .wrap{height:100vh;display:flex;flex-direction:column;}
    .topbar{
      height:44px;background:var(--surface);border-bottom:1px solid var(--outline);
      display:flex;align-items:center;gap:8px;padding:0 10px;box-shadow:var(--shadow);flex-shrink:0;
    }
    .title{font-weight:700;font-size:13px;margin-right:auto;}
    .btn{
      border:1px solid var(--outline);background:var(--surface);color:var(--text);
      height:30px;padding:0 10px;border-radius:8px;cursor:pointer;font-size:12px;line-height:28px;
    }
    .btn.primary{border-color:transparent;background:var(--primary);color:white;}
    .btn.danger{border-color:transparent;background:var(--danger);color:white;}
    .btn:disabled{opacity:0.55;cursor:not-allowed;}
    .btn:focus-visible{outline:2px solid rgba(25,118,210,0.45);outline-offset:1px;}
    .content{flex:1;overflow:auto;padding:10px;}
    .panel{
      background:var(--surface);border:1px solid var(--outline);border-radius:12px;
      padding:10px;box-shadow:var(--shadow);margin-bottom:10px;
    }
    .drop{
      border:2px dashed rgba(25,118,210,0.35);
      background:rgba(25,118,210,0.05);
      border-radius:12px;padding:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;
    }
    .drop strong{font-size:13px;}
    .hint{color:var(--muted);font-size:12px;line-height:1.5;}
    .previewWrap{display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap;}
    .preview{
      width:180px;height:120px;border-radius:10px;border:1px solid var(--outline);
      background:#fff;object-fit:contain;display:block;
    }
    .meta{display:flex;flex-direction:column;gap:6px;min-width:220px;flex:1;}
    .kv{font-size:12px;color:var(--muted);}
    .kv b{color:var(--text);font-weight:600;}
    .err{color:var(--danger);font-size:12px;white-space:pre-wrap;}
    .results{display:flex;flex-direction:column;gap:10px;}
    .card{
      border:1px solid var(--outline);border-radius:12px;background:var(--surface);box-shadow:var(--shadow);
      overflow:hidden;
    }
    .cardHead{
      padding:10px 12px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--outline);
    }
    .badge{font-size:11px;color:var(--muted);border:1px solid var(--outline);padding:2px 8px;border-radius:999px;background:#fff;}
    .cardTitle{font-weight:700;font-size:13px;}
    .spacer{margin-left:auto;}
    .cardBody{padding:10px 12px;display:flex;gap:12px;flex-wrap:wrap;}
    .thumb{width:220px;max-width:100%;border:1px solid var(--outline);border-radius:10px;background:#fff;object-fit:contain;}
    .info{flex:1;min-width:240px;display:flex;flex-direction:column;gap:8px;}
    .line{font-size:12px;color:var(--muted);}
    .line b{color:var(--text);font-weight:600;}
    .row{display:flex;gap:8px;flex-wrap:wrap;}
    .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;}
    .video{width:100%;max-width:520px;border-radius:10px;border:1px solid var(--outline);background:#000;}
  `

  function $(sel) {
    return document.querySelector(sel)
  }

  function escapeHtml(s) {
    return String(s || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;')
  }

  function safeHttpUrl(u) {
    const s = String(u || '').trim()
    if (!s) return ''
    if (s.startsWith('https://') || s.startsWith('http://')) return s
    return ''
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return ''
    const s = Math.max(0, Math.floor(seconds))
    const hh = String(Math.floor(s / 3600)).padStart(2, '0')
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  }

  function guessTitle(anilist) {
    if (!anilist || !anilist.title) return '未知标题'
    return (
      anilist.title.romaji ||
      anilist.title.native ||
      anilist.title.english ||
      '未知标题'
    )
  }

  function estimateBytesFromBase64(b64) {
    const s = (b64 || '').trim()
    if (!s) return 0
    const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0
    return Math.floor((s.length * 3) / 4) - pad
  }

  function dataUrlToBase64(dataUrl) {
    const s = String(dataUrl || '')
    const i = s.indexOf('base64,')
    if (i === -1) return ''
    return s.slice(i + 'base64,'.length)
  }

  async function readFileAsDataUrl(file) {
    return await new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result || ''))
      fr.onerror = () => reject(new Error('读取图片失败'))
      fr.readAsDataURL(file)
    })
  }

  async function loadImageFromDataUrl(dataUrl) {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('解析图片失败'))
      img.src = dataUrl
    })
  }

  async function shrinkIfNeeded(dataUrl, mime) {
    const base64 = dataUrlToBase64(dataUrl)
    const bytes = estimateBytesFromBase64(base64)
    if (bytes <= MAX_UPLOAD_BYTES && (mime || '').toLowerCase() !== 'image/bmp') {
      return { dataUrl, mime }
    }

    const img = await loadImageFromDataUrl(dataUrl)
    const w0 = img.naturalWidth || img.width
    const h0 = img.naturalHeight || img.height
    if (!w0 || !h0) return { dataUrl, mime }

    const scale = Math.min(1, MAX_DIMENSION / Math.max(w0, h0))
    const w = Math.max(1, Math.round(w0 * scale))
    const h = Math.max(1, Math.round(h0 * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return { dataUrl, mime }

    ctx.drawImage(img, 0, 0, w, h)
    const outMime = 'image/jpeg'
    const out = canvas.toDataURL(outMime, 0.86)
    return { dataUrl: out, mime: outMime }
  }

  async function setImageFromFile(file) {
    if (!file) return
    if (!file.type || !file.type.startsWith('image/')) {
      api.ui?.showToast?.('请选择图片文件')
      return
    }

    state.error = ''
    state.result = null
    state.imageName = file.name || ''

    const dataUrl = await readFileAsDataUrl(file)
    const { dataUrl: safeUrl, mime } = await shrinkIfNeeded(dataUrl, file.type || 'image/png')
    const base64 = dataUrlToBase64(safeUrl)
    const bytes = estimateBytesFromBase64(base64)
    if (!base64) {
      state.error = '图片转换失败（无法获取 base64）'
      render()
      return
    }
    if (bytes > MAX_UPLOAD_BYTES) {
      state.error = `图片过大（约 ${(bytes / 1024 / 1024).toFixed(2)}MB），请换一张或裁剪后再试`
      render()
      return
    }

    state.imageDataUrl = safeUrl
    state.imageMime = mime || 'application/octet-stream'
    render()
  }

  async function setImageFromClipboardApi() {
    state.error = ''
    state.result = null
    const dataUrl = await api.clipboard?.readImage?.()
    if (!dataUrl) {
      api.ui?.showToast?.('剪贴板没有图片')
      return
    }
    const { dataUrl: safeUrl, mime } = await shrinkIfNeeded(dataUrl, 'image/png')
    const base64 = dataUrlToBase64(safeUrl)
    const bytes = estimateBytesFromBase64(base64)
    if (!base64) {
      state.error = '剪贴板图片转换失败'
      render()
      return
    }
    if (bytes > MAX_UPLOAD_BYTES) {
      state.error = `剪贴板图片过大（约 ${(bytes / 1024 / 1024).toFixed(2)}MB），请裁剪后再试`
      render()
      return
    }
    state.imageDataUrl = safeUrl
    state.imageMime = mime || 'image/png'
    state.imageName = 'clipboard.png'
    render()
  }

  function buildMarkdown(data) {
    const list = (data && data.result) || []
    if (!Array.isArray(list) || list.length === 0) return '未找到匹配结果。'

    const top = list.slice(0, 3)
    const lines = ['### 🔍 以图找番结果', '', `来源：trace.moe`, '']
    top.forEach((m, idx) => {
      const title = guessTitle(m.anilist)
      const sim = Number.isFinite(m.similarity) ? (m.similarity * 100).toFixed(2) : '0.00'
      const ep = m.episode ? `EP ${m.episode}` : 'EP ?'
      const t = m.from != null && m.to != null ? `${formatTime(m.from)} - ${formatTime(m.to)}` : ''
      lines.push(`**${idx + 1}. ${title}**`)
      lines.push(`- 相似度：${sim}%`)
      lines.push(`- ${ep}${t ? `，时间：${t}` : ''}`)
      if (m.video) lines.push(`- 视频：${m.video}`)
      if (m.image) lines.push(`- 截图：${m.image}`)
      lines.push('')
    })
    return lines.join('\n')
  }

  async function doSearch() {
    if (state.busy) return
    if (!state.imageDataUrl) {
      api.ui?.showToast?.('先放一张图片进来')
      return
    }

    const base64 = dataUrlToBase64(state.imageDataUrl)
    if (!base64) {
      api.ui?.showToast?.('图片数据异常')
      return
    }

    state.busy = true
    state.error = ''
    state.result = null
    render()

    try {
      const resp = await api.net.request({
        method: 'POST',
        url: TRACE_MOE_API,
        headers: {
          'Content-Type': state.imageMime || 'application/octet-stream',
          Accept: 'application/json',
        },
        bodyBase64: base64,
        timeoutMs: 30000,
      })

      if (!resp || typeof resp.status !== 'number') {
        throw new Error('请求失败：无响应')
      }

      if (resp.status < 200 || resp.status >= 300) {
        const brief = String(resp.body || '').slice(0, 200)
        throw new Error(`请求失败：HTTP ${resp.status}${brief ? `，${brief}` : ''}`)
      }

      const data = JSON.parse(resp.body || '{}')
      if (data && data.error) {
        throw new Error(String(data.error))
      }
      state.result = data
    } catch (e) {
      state.error = String(e && e.message ? e.message : e)
    } finally {
      state.busy = false
      render()
    }
  }

  function clearAll() {
    state.busy = false
    state.imageDataUrl = ''
    state.imageMime = ''
    state.imageName = ''
    state.result = null
    state.error = ''
    render()
  }

  async function copyText(text) {
    try {
      await api.clipboard?.writeText?.(String(text || ''))
      api.ui?.showToast?.('已复制')
    } catch (e) {
      api.ui?.showToast?.('复制失败')
    }
  }

  function mount() {
    const root = document.getElementById('app') || document.body
    root.innerHTML = `
      <style>${styles}</style>
      <div class="wrap" data-role="wrap">
        <div class="topbar">
          <button class="btn" data-act="back">返回</button>
          <div class="title">以图找番 (trace.moe)</div>
          <button class="btn" data-act="pick">选择图片</button>
          <button class="btn" data-act="clip">读剪贴板</button>
          <button class="btn primary" data-act="search">开始搜索</button>
        </div>
        <div class="content">
          <div class="panel">
            <div class="drop" data-role="drop">
              <div style="flex:1;min-width:240px">
                <strong>拖拽 / 粘贴 / 上传图片</strong>
                <div class="hint">
                  - 拖拽图片到这里<br/>
                  - 在此窗口按 Ctrl+V 粘贴图片<br/>
                  - 或点击“选择图片 / 读剪贴板”
                </div>
              </div>
              <button class="btn danger" data-act="clear">清空</button>
            </div>
          </div>

          <div class="panel">
            <div class="previewWrap">
              <img class="preview" data-role="preview" alt="preview" />
              <div class="meta">
                <div class="kv"><b>图片：</b><span data-role="name">-</span></div>
                <div class="kv"><b>提示：</b>为了稳定上传，大图会自动缩放/转 JPEG</div>
                <div class="err" data-role="error" style="display:none"></div>
              </div>
            </div>
          </div>

          <div class="panel" data-role="resultWrap" style="display:none">
            <div class="row" style="margin-bottom:10px">
              <button class="btn" data-act="copy-md">复制 Markdown</button>
              <button class="btn" data-act="copy-json">复制 JSON</button>
            </div>
            <div class="results" data-role="results"></div>
            <details style="margin-top:10px">
              <summary class="hint">查看原始响应</summary>
              <pre class="mono" data-role="raw" style="white-space:pre-wrap;margin:10px 0 0 0;font-size:12px;"></pre>
            </details>
          </div>
        </div>

        <input type="file" accept="image/*" data-role="file" style="display:none" />
      </div>
    `

    const wrap = $('[data-role="wrap"]')
    const file = $('[data-role="file"]')
    const drop = $('[data-role="drop"]')

    if (file instanceof HTMLInputElement) {
      file.addEventListener('change', async () => {
        const f = file.files && file.files[0]
        if (f) await setImageFromFile(f)
        file.value = ''
      })
    }

    if (drop instanceof HTMLElement) {
      drop.addEventListener('dragover', (e) => {
        e.preventDefault()
        e.dataTransfer && (e.dataTransfer.dropEffect = 'copy')
      })
      drop.addEventListener('drop', async (e) => {
        e.preventDefault()
        const dt = e.dataTransfer
        const f = dt && dt.files && dt.files[0]
        if (f) await setImageFromFile(f)
      })
    }

    wrap &&
      wrap.addEventListener('paste', async (e) => {
        try {
          const items = e.clipboardData && e.clipboardData.items
          if (!items) return
          for (const it of items) {
            if (it && it.type && it.type.startsWith('image/')) {
              const f = it.getAsFile()
              if (f) {
                await setImageFromFile(f)
                e.preventDefault()
                return
              }
            }
          }
        } catch {}
      })

    root.addEventListener('click', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const act = t.getAttribute('data-act')
      if (!act) return

      if (act === 'back') return api.ui?.back ? api.ui.back() : api.ui?.showToast?.('无法返回')
      if (act === 'pick') return file && file.click()
      if (act === 'clip') return setImageFromClipboardApi()
      if (act === 'search') return doSearch()
      if (act === 'clear') return clearAll()
      if (act === 'copy-md') return copyText(buildMarkdown(state.result))
      if (act === 'copy-json') return copyText(JSON.stringify(state.result || {}, null, 2))
    })
  }

  function render() {
    const preview = $('[data-role="preview"]')
    if (preview instanceof HTMLImageElement) {
      preview.src = state.imageDataUrl || ''
      preview.style.opacity = state.imageDataUrl ? '1' : '0.2'
    }

    const nameEl = $('[data-role="name"]')
    if (nameEl instanceof HTMLElement) {
      nameEl.textContent = state.imageName || (state.imageDataUrl ? 'image' : '-')
    }

    const err = $('[data-role="error"]')
    if (err instanceof HTMLElement) {
      err.textContent = state.error || ''
      err.style.display = state.error ? 'block' : 'none'
    }

    const resultWrap = $('[data-role="resultWrap"]')
    if (resultWrap instanceof HTMLElement) {
      resultWrap.style.display = state.result ? 'block' : 'none'
    }

    const resultsEl = $('[data-role="results"]')
    if (resultsEl instanceof HTMLElement) {
      if (!state.result) {
        resultsEl.innerHTML = ''
      } else {
        const list = (state.result && state.result.result) || []
        if (!Array.isArray(list) || list.length === 0) {
          resultsEl.innerHTML = `<div class="hint">未找到匹配结果。</div>`
        } else {
          resultsEl.innerHTML = list.slice(0, 5).map((m, idx) => {
            const title = guessTitle(m.anilist)
            const sim = Number.isFinite(m.similarity) ? (m.similarity * 100).toFixed(2) : '0.00'
            const ep = m.episode ? String(m.episode) : '?'
            const t = m.from != null && m.to != null ? `${formatTime(m.from)} - ${formatTime(m.to)}` : ''
            const image = safeHttpUrl(m.image)
            const video = safeHttpUrl(m.video)
            const anilistId = m.anilist && m.anilist.id ? String(m.anilist.id) : ''
            const anilistUrl = anilistId ? `https://anilist.co/anime/${anilistId}` : ''

            return `
              <div class="card">
                <div class="cardHead">
                  <span class="badge">#${idx + 1}</span>
                  <div class="cardTitle">${escapeHtml(title)}</div>
                  <span class="spacer"></span>
                  <span class="badge">相似度 ${sim}%</span>
                </div>
                <div class="cardBody">
                  ${image ? `<img class="thumb" src="${escapeHtml(image)}" alt="thumb" />` : ''}
                  <div class="info">
                    <div class="line"><b>集数：</b>${ep}${t ? ` <span class="badge">时间 ${t}</span>` : ''}</div>
                    ${m.filename ? `<div class="line"><b>文件：</b><span class="mono">${escapeHtml(String(m.filename))}</span></div>` : ''}
                    <div class="row">
                      <button class="btn" data-act="copy-title" data-copy="${encodeURIComponent(title)}">复制标题</button>
                      ${anilistUrl ? `<button class="btn" data-act="copy-anilist" data-copy="${encodeURIComponent(anilistUrl)}">复制 AniList</button>` : ''}
                      ${video ? `<button class="btn" data-act="copy-video" data-copy="${encodeURIComponent(video)}">复制视频链接</button>` : ''}
                      ${image ? `<button class="btn" data-act="copy-image" data-copy="${encodeURIComponent(image)}">复制截图链接</button>` : ''}
                    </div>
                    ${video ? `<video class="video" src="${escapeHtml(video)}" controls muted playsinline preload="none"></video>` : ''}
                  </div>
                </div>
              </div>
            `
          }).join('')
        }
      }
    }

    const raw = $('[data-role="raw"]')
    if (raw instanceof HTMLElement) {
      raw.textContent = state.result ? JSON.stringify(state.result, null, 2) : ''
    }

    // 刷新按钮状态
    const searchBtn = $('[data-act="search"]')
    if (searchBtn instanceof HTMLButtonElement) {
      searchBtn.disabled = state.busy
      searchBtn.textContent = state.busy ? '搜索中…' : '开始搜索'
    }
  }

  function wireResultCopyButtons() {
    document.addEventListener('click', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const act = t.getAttribute('data-act')
      if (!act) return
      if (act !== 'copy-title' && act !== 'copy-video' && act !== 'copy-image' && act !== 'copy-anilist') return
      const v = decodeURIComponent(t.getAttribute('data-copy') || '')
      copyText(v)
    })
  }

  mount()
  wireResultCopyButtons()
  render()
})()
