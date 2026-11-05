import * as React from 'react'
import { FormControl, InputLabel, MenuItem, Select } from '@mui/material'
import { RoleEditorSection } from './RoleEditorLayout'

/** 角色的默认 hook 提示词：会话没有单独指定时沿用这里的预设。 */
export function RoleHookPromptSection(props: { controller: any; draft: any; hookPrompts?: any }) {
  const { controller, draft, hookPrompts } = props
  const presetId = String(draft?.roleHookPromptPresetId || '')
  const presets = Array.isArray(hookPrompts?.library?.presets) ? hookPrompts.library.presets : []

  return (
    <RoleEditorSection title="默认 hook 提示词" description="会话内单独指定 hook 提示词时，以会话设置为准。">
      <FormControl fullWidth>
        <InputLabel>默认 hook 提示词</InputLabel>
        <Select
          label="默认 hook 提示词"
          value={presetId}
          onChange={(event) => controller.actions.setDraft('roleHookPromptPresetId', event.target.value)}
        >
          <MenuItem value="">无默认预设</MenuItem>
          {presets.map((preset: any) => {
            const id = String(preset?.id || '')
            if (!id) return null
            return (
              <MenuItem key={id} value={id}>
                {String(preset?.name || '未命名预设')}
              </MenuItem>
            )
          })}
        </Select>
      </FormControl>
    </RoleEditorSection>
  )
}
