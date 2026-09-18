import * as React from 'react'
import { Box, Button, FormControl, IconButton, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import RefreshIcon from '@mui/icons-material/Refresh'
import SaveIcon from '@mui/icons-material/Save'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import {
  HOOK_PROMPT_POSITION_LABELS,
  HOOK_PROMPT_POSITIONS,
  HOOK_PROMPT_ROLE_LABELS,
  createHookPromptMessage,
  createHookPromptPreset,
  hookPromptRoleForPosition,
  normalizeHookPromptLibrary,
  reindexHookPromptMessages,
  type HookPromptLibrary,
  type HookPromptMessage,
  type HookPromptPosition,
  type HookPromptPreset,
  type HookPromptRole,
} from '../../domain/hookPrompt'
import { SortableItem, SortableRoot, SortableSection, verticalListSortingStrategy } from '../components/SortableDnd'
import { SettingsListItem, SettingsSection, SettingsSurface } from './SettingsSurfaces'

type HookPromptsSettingsPanelProps = {
  controller: any
  loading: boolean
  hookPrompts: any
}

function cloneLibrary(raw: unknown): HookPromptLibrary {
  return normalizeHookPromptLibrary(raw)
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function moveMessage(messages: HookPromptMessage[], activeId: string, overId: string) {
  const from = messages.findIndex((message) => message.id === activeId)
  const to = messages.findIndex((message) => message.id === overId)
  if (from < 0 || to < 0 || from === to) return messages
  if (messages[from].position !== messages[to].position) return messages
  const next = messages.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return reindexHookPromptMessages(next)
}

function messagesForPosition(preset: HookPromptPreset | null, position: HookPromptPosition) {
  const messages = Array.isArray(preset?.messages) ? preset!.messages : []
  return messages.filter((message) => message.position === position).sort((left, right) => left.order - right.order)
}

export function HookPromptsSettingsPanel(props: HookPromptsSettingsPanelProps) {
  const { controller, loading, hookPrompts } = props
  const sourceLibrary = hookPrompts?.library || { presets: [] }
  const busy = loading || !!hookPrompts?.loading
  const [draft, setDraft] = React.useState<HookPromptLibrary>(() => cloneLibrary(sourceLibrary))
  const [selectedPresetId, setSelectedPresetId] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState('')

  React.useEffect(() => {
    const next = cloneLibrary(sourceLibrary)
    setDraft(next)
    setSelectedPresetId((current) => {
      if (current && next.presets.some((preset) => preset.id === current)) return current
      return String(next.presets[0]?.id || '')
    })
  }, [sourceLibrary])

  React.useEffect(() => {
    controller.actions.refreshHookPromptLibrary?.(false)
  }, [controller])

  const selectedPreset = draft.presets.find((preset) => preset.id === selectedPresetId) || null
  const invalidPresetName = draft.presets.some((preset) => !text(preset.name))

  const replacePreset = (presetId: string, updater: (preset: HookPromptPreset) => HookPromptPreset) => {
    setDraft((current) => ({
      presets: current.presets.map((preset) => (preset.id === presetId ? updater(preset) : preset)),
    }))
  }

  const createPreset = () => {
    const preset = createHookPromptPreset()
    setDraft((current) => ({ presets: current.presets.concat(preset) }))
    setSelectedPresetId(preset.id)
  }

  const deletePreset = (presetId: string) => {
    setDraft((current) => {
      const presets = current.presets.filter((preset) => preset.id !== presetId)
      if (selectedPresetId === presetId) setSelectedPresetId(String(presets[0]?.id || ''))
      return { presets }
    })
  }

  const addMessage = (position: HookPromptPosition) => {
    if (!selectedPreset) return
    const message = createHookPromptMessage(position)
    replacePreset(selectedPreset.id, (preset) => ({
      ...preset,
      messages: reindexHookPromptMessages(preset.messages.concat(message)),
      updatedAt: new Date().toISOString(),
    }))
  }

  const updateMessage = (messageId: string, patch: Partial<HookPromptMessage>) => {
    if (!selectedPreset) return
    replacePreset(selectedPreset.id, (preset) => ({
      ...preset,
      messages: preset.messages.map((message) => (message.id === messageId ? { ...message, ...patch, updatedAt: new Date().toISOString() } : message)),
      updatedAt: new Date().toISOString(),
    }))
  }

  const deleteMessage = (messageId: string) => {
    if (!selectedPreset) return
    replacePreset(selectedPreset.id, (preset) => ({
      ...preset,
      messages: reindexHookPromptMessages(preset.messages.filter((message) => message.id !== messageId)),
      updatedAt: new Date().toISOString(),
    }))
  }

  const moveMessageWithinPreset = (activeId: string, overId: string) => {
    if (!selectedPreset) return
    replacePreset(selectedPreset.id, (preset) => ({
      ...preset,
      messages: moveMessage(preset.messages, activeId, overId),
      updatedAt: new Date().toISOString(),
    }))
  }

  const saveDraft = async () => {
    if (invalidPresetName) {
      setSaveError('预设名称不能为空')
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      const saved = await controller.actions.saveHookPromptLibrary?.(draft)
      setDraft(cloneLibrary(saved || draft))
    } catch (e) {
      setSaveError(String((e as any)?.message || e || '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  const canSave = !busy && !saving && !invalidPresetName

  return (
    <SettingsSurface>
      <Stack spacing={1.5}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 900 }}>hook 提示词</Typography>
            <Typography variant="caption" color="text.secondary">预设保存在业务端；聊天里只选择一个当前要用的预设。</Typography>
          </Box>
          <Button startIcon={<RefreshIcon />} variant="text" onClick={() => controller.actions.refreshHookPromptLibrary?.(true)} disabled={busy || saving}>{hookPrompts?.loading ? '刷新中…' : '刷新'}</Button>
          <Button startIcon={<AddIcon />} variant="text" onClick={createPreset} disabled={busy || saving}>新建预设</Button>
          <Button startIcon={<SaveIcon />} variant="contained" onClick={saveDraft} disabled={!canSave}>{saving ? '保存中…' : '保存'}</Button>
        </Stack>

        {hookPrompts?.error ? <Typography variant="body2" color="error">{String(hookPrompts.error || '')}</Typography> : null}
        {saveError ? <Typography variant="body2" color="error">{saveError}</Typography> : null}
        {invalidPresetName ? <Typography variant="body2" color="error">预设名称不能为空。</Typography> : null}

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems="flex-start">
          <SettingsSection tone="muted" sx={{ p: 1, width: { xs: '100%', md: 260 } }}>
            <Stack spacing={1}>
              <Typography variant="body2" sx={{ fontWeight: 900 }}>预设列表</Typography>
              {draft.presets.length ? draft.presets.map((preset) => {
                const selected = preset.id === selectedPresetId
                return (
                  <Button key={preset.id} variant={selected ? 'contained' : 'text'} color={selected ? 'primary' : 'inherit'} onClick={() => setSelectedPresetId(preset.id)} sx={{ justifyContent: 'flex-start', textTransform: 'none' }}>
                    <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preset.name || '未命名预设'}</Box>
                  </Button>
                )
              }) : <Typography variant="body2" color="text.secondary">暂无预设。</Typography>}
            </Stack>
          </SettingsSection>

          <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
            {selectedPreset ? (
              <Stack spacing={1.25}>
                <SettingsSection>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                    <TextField
                      size="small"
                      label="预设名称"
                      value={selectedPreset.name}
                      onChange={(e) => replacePreset(selectedPreset.id, (preset) => ({ ...preset, name: e.target.value, updatedAt: new Date().toISOString() }))}
                      sx={{ flex: 1 }}
                    />
                    <Button color="error" startIcon={<DeleteOutlineIcon />} onClick={() => deletePreset(selectedPreset.id)} disabled={busy || saving}>删除预设</Button>
                  </Stack>
                </SettingsSection>

                <SortableRoot onMove={moveMessageWithinPreset}>
                  <Stack spacing={1.25}>
                    {HOOK_PROMPT_POSITIONS.map((position) => (
                      <HookPromptPositionBlock
                        key={position}
                        position={position}
                        messages={messagesForPosition(selectedPreset, position)}
                        disabled={busy || saving}
                        onAdd={() => addMessage(position)}
                        onUpdate={updateMessage}
                        onDelete={deleteMessage}
                      />
                    ))}
                  </Stack>
                </SortableRoot>
              </Stack>
            ) : (
              <SettingsSection sx={{ p: 2 }}>
                <Typography variant="body2" color="text.secondary">选择一个预设，或新建预设后开始编辑。</Typography>
              </SettingsSection>
            )}
          </Box>
        </Stack>
      </Stack>
    </SettingsSurface>
  )
}

function HookPromptPositionBlock(props: {
  position: HookPromptPosition
  messages: HookPromptMessage[]
  disabled: boolean
  onAdd: () => void
  onUpdate: (messageId: string, patch: Partial<HookPromptMessage>) => void
  onDelete: (messageId: string) => void
}) {
  const { position, messages, disabled, onAdd, onUpdate, onDelete } = props
  return (
    <SettingsSection tone="muted">
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 900 }}>{HOOK_PROMPT_POSITION_LABELS[position]}</Typography>
            <Typography variant="caption" color="text.secondary">{position}</Typography>
          </Box>
          <IconButton aria-label={`添加${HOOK_PROMPT_POSITION_LABELS[position]}`} size="small" onClick={onAdd} disabled={disabled}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Stack>

        <SortableSection items={messages.map((message) => message.id)} strategy={verticalListSortingStrategy}>
          <Stack spacing={1}>
            {messages.length ? messages.map((message) => (
              <HookPromptMessageEditor key={message.id} message={message} disabled={disabled} onUpdate={onUpdate} onDelete={onDelete} />
            )) : <Typography variant="caption" color="text.secondary">这个位置还没有内容。</Typography>}
          </Stack>
        </SortableSection>
      </Stack>
    </SettingsSection>
  )
}

function HookPromptMessageEditor(props: {
  message: HookPromptMessage
  disabled: boolean
  onUpdate: (messageId: string, patch: Partial<HookPromptMessage>) => void
  onDelete: (messageId: string) => void
}) {
  const { message, disabled, onUpdate, onDelete } = props
  const fixedUserRole = message.position === 'inside_user_top' || message.position === 'inside_user_bottom'
  const role = hookPromptRoleForPosition(message.position, message.role)
  return (
    <SortableItem id={message.id} disabled={disabled}>
      {({ setNodeRef, setHandleRef, handleProps, isDragging, style }) => (
        <SettingsListItem ref={setNodeRef} sx={{ opacity: isDragging ? 0.72 : 1, bgcolor: 'background.paper' }} style={style as any}>
          <Stack spacing={1}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
              <IconButton ref={setHandleRef as any} size="small" disabled={disabled} {...handleProps} sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }}>
                <DragIndicatorIcon fontSize="small" />
              </IconButton>
              {fixedUserRole ? (
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 900, minWidth: 130 }}>
                  固定为用户消息
                </Typography>
              ) : (
                <FormControl size="small" sx={{ minWidth: 130 }}>
                  <InputLabel>身份</InputLabel>
                  <Select label="身份" value={role} onChange={(e) => onUpdate(message.id, { role: String(e.target.value || 'user') as HookPromptRole })} disabled={disabled}>
                    {(['system', 'user', 'assistant'] as HookPromptRole[]).map((item) => <MenuItem key={item} value={item}>{HOOK_PROMPT_ROLE_LABELS[item]}</MenuItem>)}
                  </Select>
                </FormControl>
              )}
              <Box sx={{ flex: 1 }} />
              <IconButton aria-label="删除提示内容" size="small" color="error" onClick={() => onDelete(message.id)} disabled={disabled}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Stack>
            <TextField
              size="small"
              multiline
              minRows={2}
              label="提示内容"
              value={message.content}
              onChange={(e) => onUpdate(message.id, { content: e.target.value })}
              disabled={disabled}
              fullWidth
            />
          </Stack>
        </SettingsListItem>
      )}
    </SortableItem>
  )
}
