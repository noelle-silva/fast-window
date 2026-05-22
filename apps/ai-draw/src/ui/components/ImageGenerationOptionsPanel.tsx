import * as React from 'react'
import { Alert, Box, Chip, Collapse, FormControl, InputLabel, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material'
import {
  IMAGE_BACKGROUND_OPTIONS,
  IMAGE_INPUT_FIDELITY_OPTIONS,
  IMAGE_MODERATION_OPTIONS,
  IMAGE_OUTPUT_FORMAT_OPTIONS,
  getImageGenerationOptionAvailability,
  supportedImageSizes,
  supportedImageQualities,
  validateImageGenerationOptions,
  type AiDrawImageGenerationOptions,
  type AiDrawImageProtocol,
} from '../../core/imageGenerationOptions'

type ImageGenerationOptionsPanelProps = {
  options: AiDrawImageGenerationOptions
  model: string
  protocol: AiDrawImageProtocol
  hasRefImages: boolean
  disabled?: boolean
  onChange: (patch: Partial<AiDrawImageGenerationOptions>) => void
}

const QUALITY_LABELS: Record<string, string> = {
  auto: 'auto',
  low: 'low',
  medium: 'medium',
  high: 'high',
}

export function ImageGenerationOptionsPanel(props: ImageGenerationOptionsPanelProps) {
  const { options, model, protocol, hasRefImages, disabled = false, onChange } = props
  const availability = getImageGenerationOptionAvailability({ model, protocol, hasRefImages })
  const sizeOptions = React.useMemo(() => supportedImageSizes(model), [model])
  const requestKind = hasRefImages ? 'edits' : 'generations'
  const qualityOptions = React.useMemo(() => supportedImageQualities(model, requestKind), [model, requestKind])
  const errors = validateImageGenerationOptions({ options, model, protocol, requestKind })
  const inactive = disabled || protocol === 'chat'
  const showModeration = requestKind === 'generations'
  const showInputFidelity = requestKind === 'edits'

  return (
    <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'rgba(255,255,255,0.96)', border: 0 }}>
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 900, lineHeight: 1.2 }}>本次图像参数</Typography>
            <Typography sx={{ mt: 0.25, fontSize: 11, color: 'text.secondary' }}>仅影响下一次普通生成，不写入供应商配置</Typography>
          </Box>
          <Chip size="small" variant="outlined" label={protocol === 'chat' ? 'chat 协议不发送' : hasRefImages ? 'images/edits' : 'images/generations'} />
        </Stack>

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.1 }}>
          <TextField
            size="small"
            label="尺寸"
            value={options.size}
            onChange={(event) => onChange({ size: event.target.value })}
            disabled={inactive || !availability.size}
            helperText={sizeOptions.join(' / ')}
          />

          <FormControl size="small" disabled={inactive || !availability.quality}>
            <InputLabel id="ai-draw-image-quality-label">画质</InputLabel>
            <Select
              labelId="ai-draw-image-quality-label"
              label="画质"
              value={options.quality}
              onChange={(event) => onChange({ quality: event.target.value as AiDrawImageGenerationOptions['quality'] })}
            >
              {qualityOptions.map((quality) => (
                <MenuItem key={quality} value={quality}>{QUALITY_LABELS[quality]}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" disabled={inactive || !availability.outputFormat}>
            <InputLabel id="ai-draw-output-format-label">格式</InputLabel>
            <Select
              labelId="ai-draw-output-format-label"
              label="格式"
              value={options.outputFormat}
              onChange={(event) => onChange({ outputFormat: event.target.value as AiDrawImageGenerationOptions['outputFormat'] })}
            >
              {IMAGE_OUTPUT_FORMAT_OPTIONS.map((format) => (
                <MenuItem key={format} value={format}>{format}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            size="small"
            label="压缩"
            type="number"
            value={options.outputCompression ?? ''}
            onChange={(event) => onChange({ outputCompression: event.target.value === '' ? null : Number(event.target.value) })}
            disabled={inactive || !availability.outputCompression || options.outputFormat === 'png'}
            inputProps={{ min: 0, max: 100 }}
            helperText="仅 jpeg/webp"
          />

          <FormControl size="small" disabled={inactive || !availability.background}>
            <InputLabel id="ai-draw-background-label">背景</InputLabel>
            <Select
              labelId="ai-draw-background-label"
              label="背景"
              value={options.background}
              onChange={(event) => onChange({ background: event.target.value as AiDrawImageGenerationOptions['background'] })}
            >
              {IMAGE_BACKGROUND_OPTIONS.map((background) => (
                <MenuItem key={background} value={background}>{background}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {showModeration ? (
            <FormControl size="small" disabled={inactive || !availability.moderation}>
              <InputLabel id="ai-draw-moderation-label">审核</InputLabel>
              <Select
                labelId="ai-draw-moderation-label"
                label="审核"
                value={options.moderation}
                onChange={(event) => onChange({ moderation: event.target.value as AiDrawImageGenerationOptions['moderation'] })}
              >
                {IMAGE_MODERATION_OPTIONS.map((moderation) => (
                  <MenuItem key={moderation} value={moderation}>{moderation}</MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : null}

          {showInputFidelity ? (
            <FormControl size="small" disabled={inactive || !availability.inputFidelity}>
              <InputLabel id="ai-draw-input-fidelity-label">参考保真</InputLabel>
              <Select
                labelId="ai-draw-input-fidelity-label"
                label="参考保真"
                value={options.inputFidelity || ''}
                onChange={(event) => onChange({ inputFidelity: String(event.target.value || '') as AiDrawImageGenerationOptions['inputFidelity'] || null })}
              >
                <MenuItem value="">不发送</MenuItem>
                {IMAGE_INPUT_FIDELITY_OPTIONS.map((fidelity) => (
                  <MenuItem key={fidelity} value={fidelity}>{fidelity}</MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : null}
        </Box>

        <Collapse in={!!errors.length || protocol === 'chat'}>
          {protocol === 'chat' ? (
            <Alert severity="info" sx={{ py: 0.5 }}>chat 协议由模型对话生成图片，本次图像参数不会发送到 Image API。</Alert>
          ) : errors.length ? (
            <Alert severity="warning" sx={{ py: 0.5, whiteSpace: 'pre-wrap' }}>{errors.join('\n')}</Alert>
          ) : null}
        </Collapse>
      </Stack>
    </Paper>
  )
}
