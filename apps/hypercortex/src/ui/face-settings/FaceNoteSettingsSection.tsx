import * as React from 'react'
import { Box, Button, Slider, Typography } from '@mui/material'

import type { FaceSettingField } from '../../facePlugins'
import { formatFaceSettingValue, hasFaceSettingOverride, renderFaceSettingTemplate } from '../../facePlugins/settings'
import { settingsAccentTextSx, settingsChoiceMarkSx, settingsSelectableSurfaceSx } from '../settingsUiStyles'

type Props = {
  /** 当前类型的声明字段清单；宿主按声明通用渲染笔记级覆盖。 */
  fields: readonly FaceSettingField[]
  noteValues: Record<string, unknown>
  globalValues: Record<string, unknown>
  effectiveValues: Record<string, unknown>
  busy: boolean
  /** 提交笔记级设置补丁；null 表示清除覆盖、跟随全局。返回是否保存成功。 */
  onPatch: (patch: Record<string, unknown | null>) => Promise<boolean>
}

/** 笔记设置里的面配置区块：按声明字段通用渲染笔记级覆盖。 */
export function FaceNoteSettingsSection({ fields, noteValues, globalValues, effectiveValues, busy, onPatch }: Props) {
  if (!fields.length) return null
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {fields.map(field => (
        <FaceSettingNoteField
          key={field.key}
          field={field}
          noteValues={noteValues}
          globalValues={globalValues}
          effectiveValues={effectiveValues}
          busy={busy}
          onPatch={onPatch}
        />
      ))}
    </Box>
  )
}

function FaceSettingNoteField(props: {
  field: FaceSettingField
  noteValues: Record<string, unknown>
  globalValues: Record<string, unknown>
  effectiveValues: Record<string, unknown>
  busy: boolean
  onPatch: (patch: Record<string, unknown | null>) => Promise<boolean>
}) {
  const { field, noteValues, globalValues, effectiveValues, busy, onPatch } = props
  const hasOverride = hasFaceSettingOverride(field, noteValues)
  const effectiveValue = effectiveValues[field.key] ?? field.default
  const globalValue = globalValues[field.key] ?? field.default

  if (field.kind === 'enum') {
    const options = [
      {
        value: null as string | null,
        label: '跟随全局',
        description: `不单独设置，使用全局「${field.label}」：${formatFaceSettingValue(field, globalValue)}。`,
      },
      ...field.options.map(item => ({ value: item.value as string | null, label: item.label, description: item.description || '' })),
    ]
    return (
      <Box>
        <Typography sx={{ fontSize: 16, lineHeight: 1.3, fontWeight: 900, color: 'var(--hc-text)' }}>
          {field.label}
        </Typography>
        <Typography sx={{ mt: 0.5, fontSize: 12.5, lineHeight: 1.6, color: 'var(--hc-text-muted)' }}>
          这篇笔记自己的设置优先于全局设置；未单独设置时跟随全局。
        </Typography>
        <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {options.map(option => {
            const active = option.value === null ? !hasOverride : hasOverride && effectiveValue === option.value
            return (
              <Box
                key={option.value ?? 'global'}
                role="button"
                tabIndex={0}
                aria-pressed={active}
                onClick={() => {
                  if (busy || active) return
                  void onPatch({ [field.key]: option.value })
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    if (!busy && !active) void onPatch({ [field.key]: option.value })
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
                  {option.description ? (
                    <Typography sx={{ mt: 0.35, fontSize: 12, lineHeight: 1.5, color: 'var(--hc-text-muted)' }}>
                      {option.description}
                    </Typography>
                  ) : null}
                </Box>
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  }

  return (
    <NumberOverrideField
      field={field}
      hasOverride={hasOverride}
      effectiveValue={effectiveValue}
      busy={busy}
      onPatch={onPatch}
    />
  )
}

function NumberOverrideField(props: {
  field: Extract<FaceSettingField, { kind: 'number' }>
  hasOverride: boolean
  effectiveValue: unknown
  busy: boolean
  onPatch: (patch: Record<string, unknown | null>) => Promise<boolean>
}) {
  const { field, hasOverride, effectiveValue, busy, onPatch } = props
  const effectiveNumber = Number(effectiveValue)
  const [draft, setDraft] = React.useState(effectiveNumber)
  const draggingRef = React.useRef(false)

  React.useEffect(() => {
    if (!draggingRef.current) setDraft(effectiveNumber)
  }, [effectiveNumber])

  const commit = React.useCallback(async (value: number | null) => {
    if (value == null && !hasOverride) return
    if (value != null && hasOverride && Math.abs(value - effectiveNumber) < 0.0001) return
    const saved = await onPatch({ [field.key]: value })
    if (!saved) setDraft(effectiveNumber)
  }, [effectiveNumber, field.key, hasOverride, onPatch])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, px: 1.25, py: 1, borderRadius: 2, bgcolor: 'var(--hc-surface-soft)' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'var(--hc-text)' }}>
          {field.label}
        </Typography>
        <Typography
          sx={{
            fontSize: 11.5,
            ...(hasOverride ? settingsAccentTextSx() : { color: 'var(--hc-text-muted)', fontWeight: 700 }),
          }}
        >
          {hasOverride ? '笔记级' : '跟随全局'}
        </Typography>
      </Box>
      {field.noteDescription ? (
        <Typography sx={{ fontSize: 12, lineHeight: 1.5, color: 'var(--hc-text-muted)' }}>
          {renderFaceSettingTemplate(field.noteDescription, field, effectiveValue)}
        </Typography>
      ) : null}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ flex: 1, minWidth: 160, maxWidth: 320, px: 0.5 }}>
          <Slider
            size="small"
            min={field.min}
            max={field.max}
            step={field.step}
            value={Number.isFinite(draft) ? draft : field.default}
            disabled={busy}
            onChange={(_, next) => {
              draggingRef.current = true
              setDraft(Array.isArray(next) ? next[0] : next)
            }}
            onChangeCommitted={(_, next) => {
              draggingRef.current = false
              void commit(Array.isArray(next) ? next[0] : next)
            }}
            aria-label={field.label}
          />
        </Box>
        <Typography sx={{ minWidth: 52, fontSize: 12, textAlign: 'right', ...settingsAccentTextSx() }}>
          {formatFaceSettingValue(field, draft)}
        </Typography>
        <Button size="small" disabled={busy || !hasOverride} onClick={() => void commit(null)}>
          恢复全局
        </Button>
      </Box>
    </Box>
  )
}
