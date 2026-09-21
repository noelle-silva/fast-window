import type { IdentityInfo } from './types'

/** 登录信息来源网址的域名（小写）；无法解析时为空串。 */
export function identityHost(url: string): string {
  try {
    return new URL(url.trim()).host.toLowerCase()
  } catch {
    return ''
  }
}

/** 登录信息的展示名：名称为空时回退空间标识。 */
export function identityDisplayName(identity: IdentityInfo): string {
  return identity.name || identity.spaceId
}

/** 与目标网址同域名的登录信息（含指定空间自身），供图标编辑选择「登录信息」。 */
export function identityOptionsForUrl(identities: IdentityInfo[], url: string, ownSpaceId: string): IdentityInfo[] {
  const host = identityHost(url)
  return identities.filter(identity => identity.spaceId === ownSpaceId || (host !== '' && identityHost(identity.url) === host))
}

/** 创建时间的展示文本。 */
export function formatIdentityCreatedAt(createdAtMs: number): string {
  if (!createdAtMs) return '未知'
  const date = new Date(createdAtMs)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
