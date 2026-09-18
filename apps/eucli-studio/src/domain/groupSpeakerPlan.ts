export type GroupSpeakerPlan = {
  roleIds: string[]
  error: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function uniqueTextList(value: unknown) {
  const list = Array.isArray(value) ? value : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const id = text(item)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function integerInRange(min: number, max: number) {
  const lo = Math.ceil(min)
  const hi = Math.floor(max)
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

function weightedPickWithoutReplacement(items: Array<{ roleId: string; weight: number }>, count: number) {
  const pool = items.slice()
  const picked: string[] = []
  while (picked.length < count && pool.length) {
    const total = pool.reduce((sum, item) => sum + item.weight, 0)
    if (total <= 0) break
    let cursor = Math.random() * total
    let index = 0
    for (; index < pool.length; index++) {
      cursor -= pool[index].weight
      if (cursor <= 0) break
    }
    const [item] = pool.splice(Math.min(index, pool.length - 1), 1)
    picked.push(item.roleId)
  }
  return picked
}

export function buildGroupSpeakerPlan(group: any, roleExists: (roleId: string) => boolean): GroupSpeakerPlan {
  const memberRoleIds = uniqueTextList(group?.memberRoleIds)
  if (!memberRoleIds.length) return { roleIds: [], error: '群组没有成员角色' }

  const missingRoleIds = memberRoleIds.filter((roleId) => !roleExists(roleId))
  if (missingRoleIds.length) return { roleIds: [], error: `群组成员角色不存在：${missingRoleIds.join('、')}` }

  const mode = text(group?.mode) === 'random' ? 'random' : 'roundRobin'
  if (mode !== 'random') {
    const order = uniqueTextList(group?.roundRobinOrder).filter((roleId) => memberRoleIds.includes(roleId))
    const seen = new Set(order)
    for (const roleId of memberRoleIds) {
      if (seen.has(roleId)) continue
      seen.add(roleId)
      order.push(roleId)
    }
    return order.length ? { roleIds: order, error: '' } : { roleIds: [], error: '群组轮流顺序为空' }
  }

  const random = group?.random && typeof group.random === 'object' ? group.random : {}
  const weightsByRoleId = random.weightsByRoleId && typeof random.weightsByRoleId === 'object' ? random.weightsByRoleId : {}
  const candidates = memberRoleIds
    .map((roleId) => ({ roleId, weight: Math.max(0, Number((weightsByRoleId as any)[roleId] ?? 1)) }))
    .filter((item) => Number.isFinite(item.weight) && item.weight > 0)
  if (!candidates.length) return { roleIds: [], error: '随机模式没有权重大于 0 的成员角色' }

  const minCount = Math.max(1, Math.round(Number(random.minCount || 1)))
  const maxCount = Math.max(minCount, Math.round(Number(random.maxCount || minCount)))
  if (candidates.length < minCount) return { roleIds: [], error: '随机模式可参与成员少于最少参与角色数' }

  const count = integerInRange(minCount, Math.min(maxCount, candidates.length))
  const roleIds = weightedPickWithoutReplacement(candidates, count)
  return roleIds.length ? { roleIds, error: '' } : { roleIds: [], error: '随机模式没有选出发言成员' }
}
