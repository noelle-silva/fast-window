import { Box, Slider, Stack, Typography } from '@mui/material'
import {
  CHAT_BG_BLUR_MAX,
  CHAT_BG_BLUR_MIN,
  CHAT_BG_OPACITY_MAX,
  CHAT_BG_OPACITY_MIN,
  COMPOSER_BLUR_MAX,
  COMPOSER_BLUR_MIN,
  COMPOSER_OPACITY_MAX,
  COMPOSER_OPACITY_MIN,
  TOPBAR_BLUR_MAX,
  TOPBAR_BLUR_MIN,
  TOPBAR_OPACITY_MAX,
  TOPBAR_OPACITY_MIN,
  normalizeChatBgBlur,
  normalizeChatBgOpacity,
  normalizeComposerBlur,
  normalizeComposerOpacity,
  normalizeTopbarBlur,
  normalizeTopbarOpacity,
} from '../../domain/appearanceSettings'
import { isTransparentChatBg } from '../../domain/wallpaper'
import { SettingsSection } from './SettingsSurfaces'

// 「组件调节」是壁纸的从属面板：聊天背景 / 顶部栏 / 输入栏的透明度与磨砂度
// 只有在壁纸启用（聊天背景按透明模式渲染）时才有作用对象，因此它挂在壁纸
// 区块内部作为一个子块，不再单列为客户端外观的独立分类。
//
// 六行调节共用同一份行结构（标签 + 读数 + 滑杆），差异只由数据表描述，
// 避免再写六份几乎一样的 JSX。

type SurfaceTuningAction = ((value: number, commit: boolean) => void) | undefined

type SurfaceTuningItem = {
  key: string
  label: string
  unit: '%' | 'px'
  min: number
  max: number
  value: number
  action: SurfaceTuningAction
}

function SurfaceTuningRow(props: {
  label: string
  unit: string
  min: number
  max: number
  value: number
  disabled: boolean
  action: SurfaceTuningAction
}) {
  const { label, unit, min, max, value, disabled, action } = props
  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="body2" sx={{ fontWeight: 900 }}>
          {label}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          {`${Math.round(value)}${unit}`}
        </Typography>
      </Stack>
      <Slider
        size="small"
        value={value}
        min={min}
        max={max}
        step={1}
        onChange={(_e, v) => action?.(Number(v), false)}
        onChangeCommitted={(_e, v) => action?.(Number(v), true)}
        disabled={disabled}
      />
    </Box>
  )
}

export function SurfaceTuningBlock(props: { controller: any; loading: boolean; settings: any }) {
  const { controller, loading, settings } = props
  const enabled = isTransparentChatBg(settings)
  const actions = controller?.actions || {}
  const items: SurfaceTuningItem[] = [
    {
      key: 'chatBgOpacity',
      label: '聊天背景透明度',
      unit: '%',
      min: CHAT_BG_OPACITY_MIN,
      max: CHAT_BG_OPACITY_MAX,
      value: normalizeChatBgOpacity(settings?.chatBgOpacity),
      action: actions.setChatBgOpacity,
    },
    {
      key: 'chatBgBlur',
      label: '聊天背景磨砂度',
      unit: 'px',
      min: CHAT_BG_BLUR_MIN,
      max: CHAT_BG_BLUR_MAX,
      value: normalizeChatBgBlur(settings?.chatBgBlur),
      action: actions.setChatBgBlur,
    },
    {
      key: 'topbarOpacity',
      label: '顶部栏透明度',
      unit: '%',
      min: TOPBAR_OPACITY_MIN,
      max: TOPBAR_OPACITY_MAX,
      value: normalizeTopbarOpacity(settings?.topbarOpacity),
      action: actions.setTopbarOpacity,
    },
    {
      key: 'topbarBlur',
      label: '顶部栏磨砂度',
      unit: 'px',
      min: TOPBAR_BLUR_MIN,
      max: TOPBAR_BLUR_MAX,
      value: normalizeTopbarBlur(settings?.topbarBlur),
      action: actions.setTopbarBlur,
    },
    {
      key: 'composerOpacity',
      label: '输入栏透明度',
      unit: '%',
      min: COMPOSER_OPACITY_MIN,
      max: COMPOSER_OPACITY_MAX,
      value: normalizeComposerOpacity(settings?.composerOpacity),
      action: actions.setComposerOpacity,
    },
    {
      key: 'composerBlur',
      label: '输入栏磨砂度',
      unit: 'px',
      min: COMPOSER_BLUR_MIN,
      max: COMPOSER_BLUR_MAX,
      value: normalizeComposerBlur(settings?.composerBlur),
      action: actions.setComposerBlur,
    },
  ]

  return (
    <SettingsSection tone="muted" sx={{ p: { xs: 1, sm: 1.25 } }}>
      <Stack spacing={1}>
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 900 }}>
            组件调节
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {enabled
              ? '透明度越低越透出壁纸，磨砂度越大背景越糊。'
              : '启用壁纸后这些调节才可使用。'}
          </Typography>
        </Box>

        {items.map((item) => (
          <SurfaceTuningRow
            key={item.key}
            label={item.label}
            unit={item.unit}
            min={item.min}
            max={item.max}
            value={item.value}
            disabled={loading || !enabled}
            action={item.action}
          />
        ))}
      </Stack>
    </SettingsSection>
  )
}
