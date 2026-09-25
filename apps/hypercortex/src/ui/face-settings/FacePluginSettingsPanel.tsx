import { Box, Slider, Typography } from '@mui/material'

import type { FaceSettingField } from '../../facePlugins'
import { formatFaceSettingValue, normalizeFaceSettingValue, renderFaceSettingTemplate } from '../../facePlugins/settings'
import { settingsAccentTextSx } from '../settingsUiStyles'
import { FaceSettingChoiceCard } from './FaceSettingChoiceCard'

type Props = {
  /** 类型标识（用于默认面板标题）。 */
  kind: string
  /** 声明字段清单；宿主按声明通用渲染。 */
  fields: readonly FaceSettingField[]
  title?: string
  intro?: string
  values: Record<string, unknown>
  disabled?: boolean
  onChange: (key: string, value: unknown) => void
}

/** 全局设置页的面配置区块：按声明字段通用渲染。 */
export function FacePluginSettingsPanel({ kind, fields, title, intro, values, disabled, onChange }: Props) {
  if (!fields.length) return null
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box>
        <Typography sx={{ fontSize: 18, lineHeight: 1.25, fontWeight: 900, color: 'var(--hc-text)' }}>
          {title || `${kind} 面设置`}
        </Typography>
        {intro ? (
          <Typography sx={{ mt: 0.5, fontSize: 13, lineHeight: 1.6, color: 'var(--hc-text-muted)' }}>
            {intro}
          </Typography>
        ) : null}
      </Box>

      {fields.map(field => (
        <FaceSettingGlobalField
          key={field.key}
          field={field}
          value={normalizeFaceSettingValue(field, values[field.key]) ?? field.default}
          disabled={disabled}
          onChange={value => onChange(field.key, value)}
        />
      ))}
    </Box>
  )
}

function FaceSettingGlobalField(props: {
  field: FaceSettingField
  value: unknown
  disabled?: boolean
  onChange: (value: unknown) => void
}) {
  const { field, value, disabled, onChange } = props

  if (field.kind === 'enum') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {field.options.map(item => (
          <FaceSettingChoiceCard
            key={item.value}
            label={item.label}
            description={item.description}
            active={value === item.value}
            disabled={disabled}
            onSelect={() => onChange(item.value)}
          />
        ))}
      </Box>
    )
  }

  const numericValue = Number(value)
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, px: 1.25, py: 1, borderRadius: 2, bgcolor: 'var(--hc-surface-soft)' }}>
      <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'var(--hc-text)' }}>
        {field.globalLabel || field.label}
      </Typography>
      {field.description ? (
        <Typography sx={{ fontSize: 12, lineHeight: 1.5, color: 'var(--hc-text-muted)' }}>
          {renderFaceSettingTemplate(field.description, field, { value: numericValue, global: numericValue })}
        </Typography>
      ) : null}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ flex: 1, minWidth: 160, maxWidth: 320, px: 0.5 }}>
          <Slider
            size="small"
            min={field.min}
            max={field.max}
            step={field.step}
            value={Number.isFinite(numericValue) ? numericValue : field.default}
            disabled={disabled}
            onChange={(_, next) => onChange(Array.isArray(next) ? next[0] : next)}
            aria-label={field.globalLabel || field.label}
          />
        </Box>
        <Typography sx={{ minWidth: 56, fontSize: 12, textAlign: 'right', ...settingsAccentTextSx() }}>
          {formatFaceSettingValue(field, value)}
        </Typography>
      </Box>
    </Box>
  )
}
