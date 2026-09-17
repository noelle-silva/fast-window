import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import type { SvgIconComponent } from '@mui/icons-material'
import type { CollectionItem, CollectionTarget } from './types'

export type CategoryDefinition = {
  label: string
  singularLabel: string
  addLabel: string
  emptyTitle: string
  emptyDescription: string
  targetLabel: string
  targetPlaceholder: string
  openError: string
  icon: SvgIconComponent
  buildTarget(value: string): CollectionTarget
  targetValue(item: CollectionItem): string
  validateTarget(value: string): string | null
}

export const URL_CATEGORY: CategoryDefinition = {
  label: '网址',
  singularLabel: '网址',
  addLabel: '添加网址',
  emptyTitle: '暂无收藏网址',
  emptyDescription: '把常用网站放到桌面上，分组管理、随手打开。',
  targetLabel: '网址',
  targetPlaceholder: '粘贴 https://example.com',
  openError: '打开网址失败',
  icon: LinkRoundedIcon,
  buildTarget: value => ({ kind: 'url', url: value.trim() }),
  targetValue: item => item.target.kind === 'url' ? item.target.url : '',
  validateTarget: value => {
    const trimmed = value.trim()
    if (!trimmed) return '网址不能为空'
    try {
      const url = new URL(trimmed)
      return url.protocol === 'http:' || url.protocol === 'https:' ? null : '网址只支持 http 或 https'
    } catch {
      return '请输入有效网址，例如 https://example.com'
    }
  },
}

export function itemTargetValue(item: CollectionItem): string {
  return item.target.kind === 'url' ? item.target.url : ''
}
