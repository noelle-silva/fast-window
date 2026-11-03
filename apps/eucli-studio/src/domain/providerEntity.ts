import { uid } from '../core/utils'
import { normalizeReasoningEffort, normalizeReasoningFields } from './reasoning'

// 供应商实体的规范化与写入比对属于领域规则：
// 控制器只负责草稿 / 状态迁移，这里保持纯函数，供保存路径与回读对账共用。

export function normalizeProviderProtocol(value: any) {
  const protocol = String(value || '').trim()
  return protocol === 'openai' || protocol === 'anthropic' ? protocol : ''
}

export function normalizeProviderApiKeys(value: any) {
  const list = Array.isArray(value) ? value : []
  return list
    .filter((key: any) => key && typeof key === 'object')
    .map((key: any, index: number) => ({
      id: String(key.id || uid('key')).trim(),
      name: String(key.name || `Key ${index + 1}`).trim(),
      key: String(key.key || '').trim(),
      enabled: typeof key.enabled === 'boolean' ? key.enabled : true,
      weight: Math.max(1, Math.round(Number(key.weight || 1))),
    }))
    .filter((key: any) => key.id && key.name && key.key)
}

export function validateProviderRegisteredModels(value: any) {
  const list = Array.isArray(value) ? value : []
  const usedIds = new Map<string, number>()
  for (let index = 0; index < list.length; index++) {
    const model = list[index]
    const line = index + 1
    if (!model || typeof model !== 'object') return `登记模型第 ${line} 行数据无效，请删除该行后重试`
    const id = String(model.id || '').trim()
    const name = String(model.name || '').trim()
    const sourceModelId = String(model.sourceModelId || '').trim()
    if (!id) return `登记模型第 ${line} 行的「自定义模型 ID」未填写`
    if (!name) return `登记模型第 ${line} 行的「显示名称」未填写`
    if (!sourceModelId) return `登记模型第 ${line} 行的「映射原始模型」未选择`
    const duplicateLine = usedIds.get(id)
    if (duplicateLine !== undefined) return `登记模型第 ${line} 行的「自定义模型 ID」与第 ${duplicateLine} 行重复`
    usedIds.set(id, line)
  }
  return ''
}

export function normalizeProviderRegisteredModels(value: any) {
  const list = Array.isArray(value) ? value : []
  return list
    .filter((model: any) => model && typeof model === 'object')
    .map((model: any) => normalizeReasoningFields({
      id: String(model.id || '').trim(),
      name: String(model.name || model.id || '').trim(),
      sourceModelId: String(model.sourceModelId || '').trim(),
      supportsReasoning: !!model.supportsReasoning,
      defaultReasoningEffort: normalizeReasoningEffort(model.defaultReasoningEffort),
    }))
    .filter((model: any) => model.id && model.sourceModelId)
}

// providerWriteSnapshot 只覆盖「一次保存真正写入的字段」：
// modelsCache 是派生缓存（服务端会按 updatedAt 重算），不参与写入比对。
function providerWriteSnapshot(provider: any) {
  return {
    id: String(provider?.id || ''),
    name: String(provider?.name || ''),
    baseUrl: String(provider?.baseUrl || ''),
    protocol: String(provider?.protocol || ''),
    apiKeyStrategy: String(provider?.apiKeyStrategy || '') === 'weighted_random' ? 'weighted_random' : 'sequential',
    apiKeys: normalizeProviderApiKeys(provider?.apiKeys),
    registeredModels: normalizeProviderRegisteredModels(provider?.registeredModels),
  }
}

// providerMatchesWrite 判断权威实体是否已经是本次写入后的值：
// 用于「写结果未知 → 回读」时决定保留本地还是回滚。
export function providerMatchesWrite(remote: any, intended: any): boolean {
  return JSON.stringify(providerWriteSnapshot(remote)) === JSON.stringify(providerWriteSnapshot(intended))
}
