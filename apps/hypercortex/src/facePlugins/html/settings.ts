import { DEFAULT_HTML_FACE_DISPLAY_MODE, HTML_FACE_DISPLAY_MODE_OPTIONS, HTML_FACE_FIXED_SCALE } from '../../htmlFaceDisplay'
import type { FaceSettingField } from '../protocol'

/** 网页面自己声明的可配置项：显示方式与缩放比例（统一两层优先级）。 */
export const HTML_FACE_SETTINGS: FaceSettingField[] = [
  {
    key: 'displayMode',
    kind: 'enum',
    label: 'HTML 面显示方式',
    default: DEFAULT_HTML_FACE_DISPLAY_MODE,
    options: HTML_FACE_DISPLAY_MODE_OPTIONS.map(item => ({ value: item.id, label: item.label, description: item.description })),
  },
  {
    key: 'fixedScale',
    kind: 'number',
    label: 'HTML 面缩放比例',
    globalLabel: '全局默认缩放比例',
    format: 'percent',
    description: '仅用于“固定视口缩放”模式。默认值为 {value}；如果某篇笔记保存了自己的缩放比例，则优先使用笔记自己的值。',
    noteDescription: '仅用于“固定视口缩放”模式；拖动结束后自动保存为这篇笔记自己的比例，全局默认为 {global}。',
    default: HTML_FACE_FIXED_SCALE.default,
    min: HTML_FACE_FIXED_SCALE.min,
    max: HTML_FACE_FIXED_SCALE.max,
    step: HTML_FACE_FIXED_SCALE.step,
  },
]
