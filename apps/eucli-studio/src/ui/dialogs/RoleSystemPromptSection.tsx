import * as React from 'react'
import { Button, Stack, TextField, Typography } from '@mui/material'
import { placeholderProblemLabel, type PlaceholderProblem } from '../../domain/placeholder'

const PREVIEW_DEBOUNCE_MS = 240

type RoleSystemPromptSectionProps = {
  controller: any
  value: string
  onChange: (next: string) => void
  preview?: { text?: string; problems?: PlaceholderProblem[] } | null
}

export function RoleSystemPromptSection(props: RoleSystemPromptSectionProps) {
  const { controller, value, onChange, preview } = props
  const [previewOpen, setPreviewOpen] = React.useState(false)

  React.useEffect(() => {
    if (!previewOpen) return
    const timer = window.setTimeout(() => {
      controller.actions.previewPlaceholders?.(value)?.catch?.(() => null)
    }, PREVIEW_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [controller, previewOpen, value])

  const problems = Array.isArray(preview?.problems) ? preview.problems : []

  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
          解析预览只展示占位符替换后的效果，不会改动保存的原文。
        </Typography>
        <Button size="small" variant={previewOpen ? 'contained' : 'outlined'} onClick={() => setPreviewOpen((open) => !open)}>
          {previewOpen ? '关闭预览' : '解析预览'}
        </Button>
      </Stack>
      <Stack direction={{ xs: 'column', md: previewOpen ? 'row' : 'column' }} spacing={1.5} alignItems="stretch">
        <TextField
          label="系统提示词"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          fullWidth
          multiline
          rows={20}
          placeholder="写入系统提示词…"
          sx={{ flex: 1, minWidth: 0 }}
        />
        {previewOpen ? (
          <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
            <TextField
              label="解析预览"
              value={String(preview?.text ?? '')}
              multiline
              rows={20}
              fullWidth
              placeholder="这里显示占位符替换后的结果…"
              InputProps={{ readOnly: true }}
            />
            {problems.length ? (
              <Typography variant="caption" color="error.main">
                解析问题：{problems.map((problem) => `${problem.name}：${placeholderProblemLabel(problem.type)}`).join('；')}
              </Typography>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Stack>
  )
}
