import * as React from 'react'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import { Box, Button, ButtonBase, FormControl, IconButton, InputLabel, Menu, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material'
import type { AiDrawProvider } from '../../core/schema'
import { OverlayScrollArea } from './OverlayScrollArea'
import { SortHandleButton, SortModeButton } from './SortControls'
import { SortableItem, SortableRoot, SortableSection, resolveSortMovePosition, type SortMovePosition } from './SortableDnd'

export type ProviderDraft = {
  name: string
  baseUrl: string
  apiKey: string
  protocol: 'images' | 'chat'
  modelsText: string
  model: string
  customModel: string
  size: string
  chatSystemPrompt: string
}

type ProviderSettingsPanelProps = {
  providers: AiDrawProvider[]
  activeProviderId: string
  draft: ProviderDraft | null
  sortMode: boolean
  onSortModeChange: (enabled: boolean) => void
  onSelectProvider: (providerId: string) => void
  onMoveProvider: (providerId: string, targetProviderId: string, position: SortMovePosition) => void
  onAddProvider: () => void
  onDeleteProvider: (provider: AiDrawProvider) => void
  deleteDisabled?: boolean
  onDraftChange: (next: ProviderDraft) => void
}

const PROVIDER_SIZE_OPTIONS = ['1024x1024', '1024x1536', '1536x1024', '512x512']

export function createProviderDraft(provider: AiDrawProvider | null): ProviderDraft | null {
  if (!provider) return null
  return {
    name: String(provider.name || ''),
    baseUrl: String(provider.baseUrl || ''),
    apiKey: String(provider.apiKey || ''),
    protocol: String(provider.protocol || 'images') === 'chat' ? 'chat' : 'images',
    modelsText: Array.isArray(provider.models) ? provider.models.join('\n') : '',
    model: String(provider.model || ''),
    customModel: String(provider.customModel || ''),
    size: String(provider.size || '1024x1024'),
    chatSystemPrompt: String(provider.chatSystemPrompt || ''),
  }
}

export function ProviderSettingsPanel(props: ProviderSettingsPanelProps) {
  const {
    providers,
    activeProviderId,
    draft,
    sortMode,
    onSortModeChange,
    onSelectProvider,
    onMoveProvider,
    onAddProvider,
    onDeleteProvider,
    deleteDisabled = false,
    onDraftChange,
  } = props

  const providerIds = React.useMemo(
    () => providers.map((provider) => String(provider.id || '').trim()).filter(Boolean),
    [providers],
  )

  const modelOptions = React.useMemo(
    () =>
      String(draft?.modelsText || '')
        .split(/\r?\n/g)
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    [draft?.modelsText],
  )

  const [providerMenu, setProviderMenu] = React.useState<{ anchorEl: HTMLElement | null; providerId: string }>({
    anchorEl: null,
    providerId: '',
  })

  const menuProvider = React.useMemo(
    () => providers.find((provider) => String(provider.id || '') === providerMenu.providerId) || null,
    [providerMenu.providerId, providers],
  )

  const handleProviderMove = React.useCallback(
    (activeId: string, overId: string) => {
      const position = resolveSortMovePosition(providerIds, activeId, overId)
      if (!position) return
      onMoveProvider(activeId, overId, position)
    },
    [onMoveProvider, providerIds],
  )

  const updateDraft = React.useCallback(
    (patch: Partial<ProviderDraft>) => {
      if (!draft) return
      onDraftChange({ ...draft, ...patch })
    },
    [draft, onDraftChange],
  )

  const closeProviderMenu = React.useCallback(() => {
    setProviderMenu({ anchorEl: null, providerId: '' })
  }, [])

  return (
    <Box sx={{ display: 'flex', gap: 2, minHeight: 0, height: '100%' }}>
      <Paper
        variant="outlined"
        sx={{ width: 272, minWidth: 272, p: 1, display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0, overflow: 'hidden' }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 1 }}>供应商</Typography>
        </Stack>

        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" onClick={onAddProvider} sx={{ flex: 1 }}>
            新增
          </Button>
          <SortModeButton enabled={sortMode} onClick={() => onSortModeChange(!sortMode)} disabled={providerIds.length <= 1} />
        </Stack>

        <OverlayScrollArea sx={{ flex: 1, minHeight: 0 }}>
          <SortableRoot onMove={handleProviderMove}>
            <SortableSection items={providerIds}>
              <Stack spacing={0.5} sx={{ pr: 0.5 }}>
                {providers.map((provider) => {
                  const providerId = String(provider.id || '')
                  const active = providerId === activeProviderId
                  const protocolLabel = provider.protocol === 'chat' ? 'chat' : 'images'
                  return (
                    <SortableItem key={providerId} id={providerId} disabled={!sortMode}>
                      {({ setNodeRef, setHandleRef, handleProps, isDragging, style }) => (
                        <Paper
                          ref={setNodeRef}
                          variant={active ? 'elevation' : 'outlined'}
                          elevation={active ? 1 : 0}
                          sx={{
                            width: '100%',
                            minHeight: 56,
                            opacity: isDragging ? 0.5 : 1,
                            bgcolor: active ? 'action.selected' : 'background.paper',
                            borderColor: active ? 'primary.main' : 'divider',
                            overflow: 'hidden',
                          }}
                          style={style}
                        >
                          <Stack direction="row" spacing={0.5} alignItems="stretch">
                            <ButtonBase
                              onClick={() => onSelectProvider(providerId)}
                              sx={{
                                flex: 1,
                                minWidth: 0,
                                display: 'flex',
                                alignItems: 'flex-start',
                                justifyContent: 'flex-start',
                                textAlign: 'left',
                                px: 0.75,
                                py: 0.75,
                              }}
                            >
                              <SortHandleButton
                                enabled={sortMode}
                                label={`拖拽排序 ${String(provider.name || '供应商')}`}
                                handleRef={setHandleRef}
                                handleProps={handleProps}
                                isDragging={isDragging}
                                sx={{ mr: 0.5, mt: 0.125 }}
                              />
                              <Box sx={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                                <Typography noWrap sx={{ fontSize: 13, fontWeight: active ? 700 : 600 }}>
                                  {provider.name || '供应商'}
                                </Typography>
                                <Typography noWrap sx={{ fontSize: 11, color: active ? 'inherit' : 'text.secondary', opacity: active ? 0.82 : 1 }}>
                                  {protocolLabel}
                                </Typography>
                              </Box>
                            </ButtonBase>

                            <Box sx={{ display: 'flex', alignItems: 'center', pr: 0.25 }}>
                              <IconButton
                                size="small"
                                aria-label={`打开 ${String(provider.name || '供应商')} 操作菜单`}
                                onClick={(event) => {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  setProviderMenu({ anchorEl: event.currentTarget, providerId })
                                }}
                              >
                                <MoreHorizRoundedIcon fontSize="small" />
                              </IconButton>
                            </Box>
                          </Stack>
                        </Paper>
                      )}
                    </SortableItem>
                  )
                })}
              </Stack>
            </SortableSection>
          </SortableRoot>
        </OverlayScrollArea>

        <Menu anchorEl={providerMenu.anchorEl} open={!!providerMenu.anchorEl} onClose={closeProviderMenu}>
          <MenuItem
            disabled={!menuProvider || deleteDisabled}
            onClick={() => {
              if (!menuProvider || deleteDisabled) return
              closeProviderMenu()
              onDeleteProvider(menuProvider)
            }}
          >
            删除
          </MenuItem>
        </Menu>
      </Paper>

      <Paper variant="outlined" sx={{ flex: 1, minWidth: 0, p: 1.5, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <OverlayScrollArea sx={{ flex: 1, minHeight: 0 }} contentSx={{ pr: 0.5 }}>
          {!draft ? (
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>请选择一个供应商。</Typography>
          ) : (
            <Stack spacing={2}>
              <Stack direction="row" spacing={2}>
                <TextField
                  fullWidth
                  size="small"
                  label="名称"
                  value={draft.name}
                  onChange={(event) => updateDraft({ name: event.target.value })}
                />
                <FormControl size="small" sx={{ width: 200 }}>
                  <InputLabel id="ai-draw-protocol-label">协议</InputLabel>
                  <Select
                    labelId="ai-draw-protocol-label"
                    label="协议"
                    value={draft.protocol}
                    onChange={(event) => updateDraft({ protocol: String(event.target.value || 'images') === 'chat' ? 'chat' : 'images' })}
                  >
                    <MenuItem value="images">images</MenuItem>
                    <MenuItem value="chat">chat</MenuItem>
                  </Select>
                </FormControl>
              </Stack>

              <TextField
                size="small"
                label="Base URL"
                value={draft.baseUrl}
                onChange={(event) => updateDraft({ baseUrl: event.target.value })}
                placeholder="https://api.openai.com/v1"
              />

              <TextField
                size="small"
                label="API Key"
                value={draft.apiKey}
                onChange={(event) => updateDraft({ apiKey: event.target.value })}
                type="password"
              />

              <Stack direction="row" spacing={2}>
                <TextField
                  size="small"
                  label="尺寸"
                  select
                  value={draft.size}
                  onChange={(event) => updateDraft({ size: String(event.target.value || '1024x1024') })}
                  sx={{ width: 220 }}
                >
                  {PROVIDER_SIZE_OPTIONS.map((size) => (
                    <MenuItem key={size} value={size}>
                      {size}
                    </MenuItem>
                  ))}
                </TextField>

                <TextField
                  size="small"
                  label="自定义模型名（当选择自定义时生效）"
                  value={draft.customModel}
                  onChange={(event) => updateDraft({ customModel: event.target.value })}
                  sx={{ flex: 1 }}
                />
              </Stack>

              <TextField
                size="small"
                label="模型列表（每行一个）"
                value={draft.modelsText}
                onChange={(event) => updateDraft({ modelsText: event.target.value })}
                multiline
                minRows={4}
                placeholder={'例如：\n' + 'gpt-image-1\n' + 'dall-e-3'}
              />

              <FormControl size="small">
                <InputLabel id="ai-draw-provider-model2-label">当前模型</InputLabel>
                <Select
                  labelId="ai-draw-provider-model2-label"
                  label="当前模型"
                  value={draft.model}
                  onChange={(event) => updateDraft({ model: String(event.target.value || '') })}
                >
                  {modelOptions.map((model) => (
                    <MenuItem key={model} value={model}>
                      {model}
                    </MenuItem>
                  ))}
                  <MenuItem value="__custom__">自定义…</MenuItem>
                </Select>
              </FormControl>

              <TextField
                size="small"
                label="Chat System Prompt（可选）"
                value={draft.chatSystemPrompt}
                onChange={(event) => updateDraft({ chatSystemPrompt: event.target.value })}
                multiline
                minRows={2}
              />
            </Stack>
          )}
        </OverlayScrollArea>
      </Paper>
    </Box>
  )
}
