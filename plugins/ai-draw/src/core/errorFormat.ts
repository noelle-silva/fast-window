export type AiDrawErrorCategory = '网络' | '服务端' | '配置' | '宿主' | '插件' | '未知'

export type AiDrawErrorContext = {
  stage?: string
  hint?: string
  method?: string
  url?: string
  timeoutMs?: number | null
  httpStatus?: number | null
  serverMessage?: string
  taskError?: string
  rawMessage?: string
}

function safeUrlText(url: any) {
  const raw = String(url ?? '').trim()
  if (!raw) return ''
  try {
    const u = new URL(raw)
    u.username = ''
    u.password = ''
    u.search = ''
    u.hash = ''
    return u.toString()
  } catch {
    return raw
  }
}

function normalizeText(v: any) {
  return String(v ?? '').replace(/\s+/g, ' ').trim()
}

function pickFirstMeaningful(...candidates: any[]) {
  for (const c of candidates) {
    const s = normalizeText(c)
    if (s) return s
  }
  return ''
}

function guessNetworkKind(text: string) {
  const s = text.toLowerCase()
  if (!s) return ''
  if (s.includes('timed out') || s.includes('timeout') || text.includes('超时')) return '连接超时'
  if (s.includes('dns') || s.includes('name not resolved') || text.includes('解析')) return 'DNS 解析失败'
  if (s.includes('certificate') || s.includes('tls') || s.includes('ssl') || text.includes('证书')) return 'TLS/证书问题'
  if (s.includes('connection refused') || text.includes('拒绝连接')) return '目标拒绝连接'
  if (s.includes('connection reset') || s.includes('reset by peer') || text.includes('重置')) return '连接被重置'
  if (s.includes('network unreachable') || s.includes('unreachable') || text.includes('不可达')) return '网络不可达'
  if (s.includes('invalid url') || text.includes('url 必须以') || text.includes('不合法')) return 'URL 配置问题'
  return '连接/请求异常'
}

function guessCategory(ctx: AiDrawErrorContext): { category: AiDrawErrorCategory; titleSuffix: string } {
  const raw = pickFirstMeaningful(ctx.serverMessage, ctx.taskError, ctx.rawMessage)
  let httpStatus = typeof ctx.httpStatus === 'number' && Number.isFinite(ctx.httpStatus) ? ctx.httpStatus : null
  if (!httpStatus) {
    const m = raw.match(/\bHTTP\s*([0-9]{3})\b/i)
    if (m) {
      const n = Number(m[1])
      if (Number.isFinite(n)) httpStatus = n
    }
  }

  if (httpStatus && (httpStatus < 200 || httpStatus >= 300)) return { category: '服务端', titleSuffix: httpStatus >= 500 ? '（上游异常）' : '' }

  if (raw.includes('Base URL') || raw.includes('API Key') || raw.includes('url 必须以 http')) return { category: '配置', titleSuffix: '' }
  if (
    (raw.includes('tauri') && raw.includes('invoke 不可用')) ||
    raw.includes('AiDrawGateway 不可用') ||
    raw.includes('gateway 不可用') ||
    raw.includes('pluginId 不合法') ||
    raw.includes('任务状态锁定失败')
  ) return { category: '宿主', titleSuffix: '' }
  if (raw.includes('请求体过大') || raw.includes('未拿到图片数据') || raw.includes('合成失败') || raw.includes('裁剪失败')) return { category: '插件', titleSuffix: '' }

  if (raw.includes('请求失败') || raw.includes('读取响应失败') || raw.includes('创建 http client 失败') || raw.includes('bodyBase64')) {
    const kind = guessNetworkKind(raw)
    return { category: kind === 'URL 配置问题' ? '配置' : '网络', titleSuffix: kind ? `（${kind}）` : '' }
  }

  return { category: '未知', titleSuffix: '' }
}

function suggestionsFor(category: AiDrawErrorCategory, httpStatus: number | null) {
  if (category === '配置') {
    return ['检查 Base URL 是否可访问（需 http(s)://）', '检查 API Key 是否正确/有权限', '模型名是否存在（自建网关请确认模型映射）']
  }
  if (category === '网络') {
    return ['确认当前网络可访问目标域名/端口', '若走代理/公司网络，检查代理与证书拦截', '适当调大“请求超时”再试一次']
  }
  if (category === '服务端') {
    if (httpStatus === 401 || httpStatus === 403) return ['大概率是 API Key 无效/无权限', '若是自建网关：检查鉴权配置']
    if (httpStatus === 429) return ['触发限流/额度不足：稍后重试或换 Key/套餐', '降低并发（批量数）再试']
    if (httpStatus && httpStatus >= 500) return ['服务端/上游模型异常：稍后重试', '若是自建网关：查看服务日志']
    return ['查看服务端返回的错误信息（下方“服务端信息”）', '确认接口路径/协议选择正确（images/chat）']
  }
  if (category === '宿主') return ['尝试重启宿主应用', '确认宿主网关版本已更新', '若多插件同时异常：可能是宿主权限/环境问题']
  if (category === '插件') return ['按提示修正输入（提示词/参考图/选区）', '减少参考图或缩小图片体积', '若持续复现：把报错完整复制给开发者']
  return ['把“详情”里的原始错误复制出来（便于定位）', '重试一次排除偶发失败']
}

export function formatAiDrawError(ctx: AiDrawErrorContext) {
  const stage = normalizeText(ctx.stage)
  const hint = normalizeText(ctx.hint)
  const method = normalizeText(ctx.method)
  const url = safeUrlText(ctx.url)
  const timeoutMs = typeof ctx.timeoutMs === 'number' && Number.isFinite(ctx.timeoutMs) ? Math.max(0, Math.floor(ctx.timeoutMs)) : null
  let httpStatus = typeof ctx.httpStatus === 'number' && Number.isFinite(ctx.httpStatus) ? ctx.httpStatus : null
  if (!httpStatus) {
    const m = pickFirstMeaningful(ctx.serverMessage, ctx.taskError, ctx.rawMessage).match(/\bHTTP\s*([0-9]{3})\b/i)
    if (m) {
      const n = Number(m[1])
      if (Number.isFinite(n)) httpStatus = n
    }
  }

  const serverMessage = normalizeText(ctx.serverMessage)
  const taskError = normalizeText(ctx.taskError)
  const rawMessage = normalizeText(ctx.rawMessage)
  const main = pickFirstMeaningful(serverMessage, taskError, rawMessage, '请求失败')

  const guessed = guessCategory({ ...ctx, serverMessage, taskError, rawMessage, httpStatus })
  const title = `【${guessed.category}】${guessed.titleSuffix} ${hint ? hint : '生成失败'}`

  const lines: string[] = [title]
  if (stage) lines.push(`阶段：${stage}`)
  if (method || url) lines.push(`请求：${[method, url].filter(Boolean).join(' ')}${timeoutMs ? `（超时 ${Math.round(timeoutMs / 1000)}s）` : ''}`)

  if (httpStatus && (httpStatus < 200 || httpStatus >= 300)) lines.push(`HTTP：${httpStatus}`)
  if (serverMessage) lines.push(`服务端信息：${serverMessage}`)
  if (taskError && taskError !== serverMessage) lines.push(`宿主任务错误：${taskError}`)
  if (rawMessage && rawMessage !== taskError && rawMessage !== serverMessage) lines.push(`详情：${rawMessage}`)
  if (!serverMessage && !taskError && !rawMessage) lines.push(`详情：${main}`)

  const sugg = suggestionsFor(guessed.category, httpStatus)
  if (sugg.length) lines.push(`建议：${sugg.join('；')}`)

  return lines.join('\n')
}
