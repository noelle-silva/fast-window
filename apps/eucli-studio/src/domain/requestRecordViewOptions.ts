export type RequestRecordViewOptions = {
  requestReasoningOpen: boolean
  requestToolCallsOpen: boolean
  requestToolResultsOpen: boolean
  requestToolsOpen: boolean
  responseReasoningOpen: boolean
  responseToolCallsOpen: boolean
}

export type RequestRecordViewOptionKey = keyof RequestRecordViewOptions

export const REQUEST_RECORD_VIEW_OPTION_ITEMS: Array<{ key: RequestRecordViewOptionKey; label: string }> = [
  { key: 'requestReasoningOpen', label: '请求体 · 思考' },
  { key: 'requestToolCallsOpen', label: '请求体 · 工具调用' },
  { key: 'requestToolResultsOpen', label: '请求体 · 工具返回' },
  { key: 'requestToolsOpen', label: '请求体 · 工具定义' },
  { key: 'responseReasoningOpen', label: '响应体 · 思考' },
  { key: 'responseToolCallsOpen', label: '响应体 · 工具调用' },
]

// 默认形态：除「请求体 · 工具定义」默认展开外，其余默认收起。
export function defaultRequestRecordViewOptions(): RequestRecordViewOptions {
  return {
    requestReasoningOpen: false,
    requestToolCallsOpen: false,
    requestToolResultsOpen: false,
    requestToolsOpen: true,
    responseReasoningOpen: false,
    responseToolCallsOpen: false,
  }
}

export function normalizeRequestRecordViewOptions(value: any): RequestRecordViewOptions {
  const options = defaultRequestRecordViewOptions()
  if (!value || typeof value !== 'object') return options
  for (const item of REQUEST_RECORD_VIEW_OPTION_ITEMS) {
    const raw = (value as any)[item.key]
    if (typeof raw === 'boolean') options[item.key] = raw
  }
  return options
}

export function setRequestRecordViewOption(options: RequestRecordViewOptions, key: RequestRecordViewOptionKey, value: boolean): RequestRecordViewOptions {
  return { ...options, [key]: !!value }
}

export function isRequestRecordViewOptionKey(value: any): value is RequestRecordViewOptionKey {
  return REQUEST_RECORD_VIEW_OPTION_ITEMS.some((item) => item.key === value)
}
