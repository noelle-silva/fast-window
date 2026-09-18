import { Button, Stack, TextField, Typography } from '@mui/material'
import { SettingsPill, SettingsSection } from './SettingsSurfaces'

type ToolPromptDescriptionSectionProps = {
  controller: any
  tool: any
  tools: any
}

export function ToolPromptDescriptionSection(props: ToolPromptDescriptionSectionProps) {
  const { controller, tool, tools } = props
  const draft = String(tools?.promptDescriptionDraft ?? '')
  const hasCustomPrompt = draft.trim() !== ''
  const canReset = draft !== ''
  const defaultPrompt = defaultToolPromptDescription(tool)

  return (
    <SettingsSection tone={hasCustomPrompt ? 'selected' : 'default'}>
      <Stack spacing={1.25}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Stack spacing={0.25} sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
              <Typography sx={{ fontWeight: 900 }}>工具提示说明</Typography>
              <SettingsPill tone={hasCustomPrompt ? 'selected' : 'muted'}>{hasCustomPrompt ? '使用自定义' : '使用默认'}</SettingsPill>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              填写后会完全替换默认工具说明；留空则继续使用默认说明。
            </Typography>
          </Stack>
          <Button size="small" variant="text" onClick={() => controller.actions.resetToolPromptDescriptionDraftToDefault?.()} disabled={!canReset}>
            恢复默认
          </Button>
        </Stack>

        <TextField
          label="自定义提示说明"
          value={draft}
          onChange={(event) => controller.actions.setToolPromptDescriptionDraft?.(event.target.value)}
          placeholder="留空时使用默认工具说明"
          fullWidth
          multiline
          minRows={4}
        />

        <SettingsSection tone="muted" sx={{ p: 1 }}>
          <Stack spacing={0.5}>
            <Typography variant="caption" sx={{ fontWeight: 900, color: 'text.secondary' }}>默认说明</Typography>
            <Typography component="pre" variant="body2" sx={{ m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', color: defaultPrompt ? 'text.primary' : 'text.secondary' }}>
              {defaultPrompt || '暂无默认说明'}
            </Typography>
          </Stack>
        </SettingsSection>
      </Stack>
    </SettingsSection>
  )
}

function defaultToolPromptDescription(tool: any): string {
  const promptDescription = String(tool?.promptDescription ?? '')
  return promptDescription.trim() ? promptDescription : String(tool?.description ?? '')
}
