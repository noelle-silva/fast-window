import * as React from 'react'
import { Box, Button, Slider, Typography } from '@mui/material'
import type { HyperCortexHtmlFaceDisplayModeV1 } from '../../core'
import { HTML_FACE_DISPLAY_MODE_OPTIONS, HTML_FACE_FIXED_SCALE } from '../../htmlFaceDisplay'
import { settingsAccentTextSx, settingsChoiceMarkSx, settingsSelectableSurfaceSx } from '../settingsUiStyles'

/** 显示方式选择：global 表示不覆盖，跟随全局设置。 */
export type HtmlFaceDisplayModeChoice = 'global' | HyperCortexHtmlFaceDisplayModeV1

type ModeOption = {
  id: HtmlFaceDisplayModeChoice
  label: string
  description: string
}

function buildModeOptions(globalMode: HyperCortexHtmlFaceDisplayModeV1): ModeOption[] {
  const globalLabel = HTML_FACE_DISPLAY_MODE_OPTIONS.find(item => item.id === globalMode)?.label || globalMode
  return [
    { id: 'global', label: '跟随全局', description: `不单独设置，使用全局显示方式：${globalLabel}。` },
    ...HTML_FACE_DISPLAY_MODE_OPTIONS.map(item => ({ id: item.id, label: item.label, description: item.description })),
  ]
}

type Props = {
  modeChoice: HtmlFaceDisplayModeChoice
  globalMode: HyperCortexHtmlFaceDisplayModeV1
  /** 生效的缩放比例（笔记级 > 全局级，由统一优先级机制解析）。 */
  fixedScale: number
  hasNoteScaleOverride: boolean
  globalScale: number
  busy: boolean
  onModeChoiceChange: (choice: HtmlFaceDisplayModeChoice) => void
  /** 提交笔记级缩放覆盖；null 表示清除覆盖、跟随全局。返回是否保存成功。 */
  onFixedScaleCommit: (scale: number | null) => Promise<boolean>
}

/** 笔记级 HTML 面显示设置：显示方式与缩放的笔记级覆盖（Q35 统一优先级）。 */
export function HtmlFaceNoteSettingsSection(props: Props) {
  const {
    modeChoice,
    globalMode,
    fixedScale,
    hasNoteScaleOverride,
    globalScale,
    busy,
    onModeChoiceChange,
    onFixedScaleCommit,
  } = props

  const modeOptions = React.useMemo(() => buildModeOptions(globalMode), [globalMode])
  const [draftScale, setDraftScale] = React.useState(fixedScale)
  const draggingRef = React.useRef(false)

  React.useEffect(() => {
    if (!draggingRef.current) setDraftScale(fixedScale)
  }, [fixedScale])

  const commitScale = React.useCallback(async (value: number | null) => {
    if (value == null && !hasNoteScaleOverride) return
    if (value != null && hasNoteScaleOverride && Math.abs(value - fixedScale) < 0.0001) return
    const saved = await onFixedScaleCommit(value)
    if (!saved) setDraftScale(fixedScale)
  }, [fixedScale, hasNoteScaleOverride, onFixedScaleCommit])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box>
        <Typography sx={{ fontSize: 16, lineHeight: 1.3, fontWeight: 900, color: 'var(--hc-text)' }}>
          HTML 面显示方式
        </Typography>
        <Typography sx={{ mt: 0.5, fontSize: 12.5, lineHeight: 1.6, color: 'var(--hc-text-muted)' }}>
          这篇笔记自己的设置优先于全局设置；未单独设置时跟随全局。
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {modeOptions.map(option => {
          const active = modeChoice === option.id
          return (
            <Box
              key={option.id}
              role="button"
              tabIndex={0}
              aria-pressed={active}
              onClick={() => {
                if (busy || active) return
                onModeChoiceChange(option.id)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  if (!busy && !active) onModeChoiceChange(option.id)
                }
              }}
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1.5,
                px: 1.5,
                py: 1,
                borderRadius: 2,
                ...settingsSelectableSurfaceSx(active),
                cursor: busy || active ? 'default' : 'pointer',
                userSelect: 'none',
                transition: 'background 120ms, box-shadow 120ms',
              }}
            >
              <Box sx={settingsChoiceMarkSx(active)}>
                {active ? (
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'var(--hc-surface)' }} />
                ) : null}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: 'var(--hc-text)', lineHeight: 1.3 }}>
                  {option.label}
                </Typography>
                <Typography sx={{ mt: 0.35, fontSize: 12, lineHeight: 1.5, color: 'var(--hc-text-muted)' }}>
                  {option.description}
                </Typography>
              </Box>
            </Box>
          )
        })}
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, px: 1.25, py: 1, borderRadius: 2, bgcolor: 'var(--hc-surface-soft)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'var(--hc-text)' }}>
            HTML 面缩放比例
          </Typography>
          <Typography
            sx={{
              fontSize: 11.5,
              ...(hasNoteScaleOverride ? settingsAccentTextSx() : { color: 'var(--hc-text-muted)', fontWeight: 700 }),
            }}
          >
            {hasNoteScaleOverride ? '笔记级' : '跟随全局'}
          </Typography>
        </Box>
        <Typography sx={{ fontSize: 12, lineHeight: 1.5, color: 'var(--hc-text-muted)' }}>
          仅用于“固定视口缩放”模式；拖动结束后自动保存为这篇笔记自己的比例，全局默认为 {Math.round(globalScale * 100)}%。
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ flex: 1, minWidth: 160, maxWidth: 320, px: 0.5 }}>
            <Slider
              size="small"
              min={HTML_FACE_FIXED_SCALE.min}
              max={HTML_FACE_FIXED_SCALE.max}
              step={HTML_FACE_FIXED_SCALE.step}
              value={draftScale}
              disabled={busy}
              onChange={(_, next) => {
                draggingRef.current = true
                setDraftScale(Array.isArray(next) ? next[0] : next)
              }}
              onChangeCommitted={(_, next) => {
                draggingRef.current = false
                void commitScale(Array.isArray(next) ? next[0] : next)
              }}
              aria-label="笔记 HTML 面缩放比例"
            />
          </Box>
          <Typography sx={{ minWidth: 52, fontSize: 12, textAlign: 'right', ...settingsAccentTextSx() }}>
            {Math.round(draftScale * 100)}%
          </Typography>
          <Button size="small" disabled={busy || !hasNoteScaleOverride} onClick={() => void commitScale(null)}>
            恢复全局
          </Button>
        </Box>
      </Box>
    </Box>
  )
}
