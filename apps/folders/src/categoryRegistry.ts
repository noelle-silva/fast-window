import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import type { SvgIconComponent } from '@mui/icons-material'
import type { CollectionCategoryId, CollectionItem, CollectionTarget } from './types'

export type CategoryDefinition = {
  id: CollectionCategoryId
  label: string
  singularLabel: string
  addLabel: string
  emptyTitle: string
  emptyDescription: string
  targetLabel: string
  targetPlaceholder: string
  pickCommand?: 'pick_folder_path' | 'pick_file_path'
  pickError: string
  openError: string
  icon: SvgIconComponent
  buildTarget(value: string): CollectionTarget
  targetValue(item: CollectionItem): string
  validateTarget(value: string): string | null
}

export const CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  {
    id: 'folder',
    label: '文件夹',
    singularLabel: '文件夹',
    addLabel: '添加文件夹',
    emptyTitle: '暂无收藏文件夹',
    emptyDescription: '添加常用目录后，可以从这里一键打开、分组管理和快速搜索。',
    targetLabel: '路径',
    targetPlaceholder: '选择或粘贴文件夹绝对路径',
    pickCommand: 'pick_folder_path',
    pickError: '选择文件夹失败',
    openError: '打开文件夹失败',
    icon: FolderRoundedIcon,
    buildTarget: value => ({ kind: 'folder', path: value.trim() }),
    targetValue: item => item.target.kind === 'folder' ? item.target.path : '',
    validateTarget: value => value.trim() ? null : '文件夹路径不能为空',
  },
  {
    id: 'url',
    label: '网址',
    singularLabel: '网址',
    addLabel: '添加网址',
    emptyTitle: '暂无收藏网址',
    emptyDescription: '添加常用网站后，可以从这里按场景分组，一键用默认浏览器打开。',
    targetLabel: '网址',
    targetPlaceholder: '粘贴 https://example.com',
    pickError: '选择网址失败',
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
  },
  {
    id: 'file',
    label: '文件',
    singularLabel: '文件',
    addLabel: '添加文件',
    emptyTitle: '暂无收藏文件',
    emptyDescription: '添加常用文件后，可以从这里按场景分组，并用系统默认应用打开。',
    targetLabel: '路径',
    targetPlaceholder: '选择或粘贴文件绝对路径',
    pickCommand: 'pick_file_path',
    pickError: '选择文件失败',
    openError: '打开文件失败',
    icon: InsertDriveFileRoundedIcon,
    buildTarget: value => ({ kind: 'file', path: value.trim() }),
    targetValue: item => item.target.kind === 'file' ? item.target.path : '',
    validateTarget: value => value.trim() ? null : '文件路径不能为空',
  },
]

const CATEGORY_BY_ID = new Map(CATEGORY_DEFINITIONS.map(category => [category.id, category]))

export function categoryDefinition(id: CollectionCategoryId): CategoryDefinition {
  const definition = CATEGORY_BY_ID.get(id)
  if (!definition) throw new Error(`unknown collection category: ${id}`)
  return definition
}

export function itemTargetValue(item: CollectionItem): string {
  return categoryDefinition(item.target.kind).targetValue(item)
}
