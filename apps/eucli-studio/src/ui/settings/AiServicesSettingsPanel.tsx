import * as React from 'react'
import { Box, Button, FormControl, InputLabel, MenuItem, Select, Slider, Stack, Switch, TextField, Typography } from '@mui/material'
import {
  DEFAULT_CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES,
  CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MIN,
  CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MAX,
} from '../../domain/constants'
import { clampNum } from '../utils/numbers'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { customScrollbarHiddenSx } from '../scroll/customScrollbars'
import { aiServiceModelSelection, aiServiceSourceSelectItems, aiServiceSourceValue } from './modelItemSelectors'
import { SettingsHeading, SettingsPill, SettingsSection, SettingsSurface } from './SettingsSurfaces'

type AiServiceId = 'contextCompression' | 'mermaidFix' | 'chatTitleNaming' | 'stickerNaming'

const AI_SERVICE_ORDER: AiServiceId[] = ['contextCompression', 'mermaidFix', 'chatTitleNaming', 'stickerNaming']

const AI_SERVICE_NAMES: Record<AiServiceId, string> = {
  contextCompression: '上下文压缩',
  mermaidFix: 'Mermaid AI 修复',
  chatTitleNaming: 'AI 聊天记录取名',
  stickerNaming: '表情包取名服务',
}

type AiServicesSettingsPanelProps = {
  controller: any
  loading: boolean
  data: any
  providers: any[]
  modelGroups: any
}

function objectOr(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {}
}

function modelSelectionSummary(selection: any, providers: any[], modelGroups: any[]) {
  const source = selection.sourceKind === 'model_group'
    ? modelGroups.find((item: any) => String(item?.id || '') === selection.sourceId)
    : providers.find((item: any) => String(item?.id || '') === selection.sourceId)
  const sourceLabel = String(source?.name || '').trim()
  if (!sourceLabel) return '未选择模型'
  const modelItem = selection.hasPickInList
    ? selection.modelItems.find((item: any) => item.id === selection.modelPick)
    : null
  const modelLabel = String(modelItem?.label || selection.modelPick || '').trim()
  return modelLabel ? `${sourceLabel} · ${modelLabel}` : `${sourceLabel} · 未选择模型`
}

export function AiServicesSettingsPanel(props: AiServicesSettingsPanelProps) {
  const { controller, loading, data, providers, modelGroups } = props
  const modelGroupList = Array.isArray(modelGroups?.items) ? modelGroups.items : []
  const aiServices = objectOr(data?.settings?.aiServices)
  const [selectedId, setSelectedId] = React.useState<AiServiceId>('contextCompression')

  const ccCfg = objectOr(aiServices.contextCompression)
  const mmCfg = objectOr(aiServices.mermaidFix)
  const ctnCfg = objectOr(aiServices.chatTitleNaming)
  const snCfg = objectOr(aiServices.stickerNaming)

  const ccSelection = aiServiceModelSelection(ccCfg, providers, modelGroupList)
  const mmSelection = aiServiceModelSelection(mmCfg, providers, modelGroupList)
  const ctnSelection = aiServiceModelSelection(ctnCfg, providers, modelGroupList)
  const snSelection = aiServiceModelSelection(snCfg, providers, modelGroupList)

  const sourceSelectDisabled = loading || (!providers.length && !modelGroupList.length)

  const serviceStates: Record<AiServiceId, { enabled: boolean | null; summary: string }> = {
    contextCompression: { enabled: null, summary: modelSelectionSummary(ccSelection, providers, modelGroupList) },
    mermaidFix: { enabled: !!mmCfg.enabled, summary: modelSelectionSummary(mmSelection, providers, modelGroupList) },
    chatTitleNaming: { enabled: !!ctnCfg.enabled, summary: modelSelectionSummary(ctnSelection, providers, modelGroupList) },
    stickerNaming: { enabled: !!snCfg.enabled, summary: modelSelectionSummary(snSelection, providers, modelGroupList) },
  }

  return (
    <SettingsSurface sx={{ height: '100%' }}>
      <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <SettingsHeading title="AI 微服务" description="选择左侧微服务，在右侧配置模型与提示词。" />
        </Stack>

        <Stack direction="row" spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
          <SettingsSection tone="muted" sx={{ p: 1, width: { xs: 200, sm: 260, lg: 300 }, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 900 }}>微服务列表</Typography>
              <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', ...customScrollbarHiddenSx }}>
                <Stack spacing={1}>
                  {AI_SERVICE_ORDER.map((id) => {
                    const selected = id === selectedId
                    const state = serviceStates[id]
                    return (
                      <Button
                        key={id}
                        variant={selected ? 'contained' : 'text'}
                        color={selected ? 'primary' : 'inherit'}
                        onClick={() => setSelectedId(id)}
                        sx={{ justifyContent: 'flex-start', minWidth: 0, width: '100%', px: 1, textTransform: 'none', textAlign: 'left' }}
                      >
                        <Box sx={{ minWidth: 0, width: '100%' }}>
                          <Stack direction="row" spacing={0.75} alignItems="center">
                            <Box component="span" sx={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{AI_SERVICE_NAMES[id]}</Box>
                            {state.enabled === null ? null : (
                              <SettingsPill tone={state.enabled ? 'selected' : 'muted'}>{state.enabled ? '已启用' : '已停用'}</SettingsPill>
                            )}
                          </Stack>
                          <Box component="span" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, opacity: 0.75 }}>
                            {state.summary}
                          </Box>
                        </Box>
                      </Button>
                    )
                  })}
                </Stack>
              </Box>
            </Stack>
          </SettingsSection>

          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            <CustomScrollArea hostSx={{ height: '100%', minHeight: 0 }} scrollSx={{ height: '100%' }}>
              {selectedId === 'contextCompression' ? (
                <ContextCompressionEditor
                  controller={controller}
                  loading={loading}
                  config={ccCfg}
                  selection={ccSelection}
                  providers={providers}
                  modelGroups={modelGroupList}
                  sourceSelectDisabled={sourceSelectDisabled}
                />
              ) : null}
              {selectedId === 'mermaidFix' ? (
                <ToggleServiceEditor
                  name={AI_SERVICE_NAMES.mermaidFix}
                  description="Mermaid 渲染失败时，可在错误块中点击“AI 修复”，用选定供应商的模型按系统提示词修复源码并替换到消息里。"
                  idPrefix="mmfix"
                  enabled={!!mmCfg.enabled}
                  onToggle={(value) => controller.actions.setMermaidFixEnabled?.(value)}
                  sourceValue={aiServiceSourceValue(mmSelection.sourceKind, mmSelection.sourceId)}
                  onSourceChange={(value) => controller.actions.setMermaidFixModelSource?.(value)}
                  selection={mmSelection}
                  onModelChange={(value) => controller.actions.setMermaidFixModelId?.(value)}
                  promptValue={typeof mmCfg.systemPrompt === 'string' ? mmCfg.systemPrompt : ''}
                  onPromptChange={(value) => controller.actions.setMermaidFixSystemPrompt?.(value)}
                  defaultPrompt={String(controller?.defaults?.mermaidFixSystemPrompt || '')}
                  onResetPrompt={() => controller.actions.resetMermaidFixSystemPromptDefault?.()}
                  promptMinRows={8}
                  loading={loading}
                  sourceSelectDisabled={sourceSelectDisabled}
                  providers={providers}
                  modelGroups={modelGroupList}
                />
              ) : null}
              {selectedId === 'chatTitleNaming' ? (
                <ToggleServiceEditor
                  name={AI_SERVICE_NAMES.chatTitleNaming}
                  description="在“聊天记录”的会话菜单里，可点击“AI 生成标题”，用选定供应商/模型按系统提示词为当前会话生成新标题。"
                  idPrefix="ctn"
                  enabled={!!ctnCfg.enabled}
                  onToggle={(value) => controller.actions.setChatTitleNamingEnabled?.(value)}
                  sourceValue={aiServiceSourceValue(ctnSelection.sourceKind, ctnSelection.sourceId)}
                  onSourceChange={(value) => controller.actions.setChatTitleNamingModelSource?.(value)}
                  selection={ctnSelection}
                  onModelChange={(value) => controller.actions.setChatTitleNamingModelId?.(value)}
                  promptValue={typeof ctnCfg.systemPrompt === 'string' ? ctnCfg.systemPrompt : ''}
                  onPromptChange={(value) => controller.actions.setChatTitleNamingSystemPrompt?.(value)}
                  defaultPrompt={String(controller?.defaults?.chatTitleNamingSystemPrompt || '')}
                  onResetPrompt={() => controller.actions.resetChatTitleNamingSystemPromptDefault?.()}
                  promptMinRows={6}
                  loading={loading}
                  sourceSelectDisabled={sourceSelectDisabled}
                  providers={providers}
                  modelGroups={modelGroupList}
                />
              ) : null}
              {selectedId === 'stickerNaming' ? (
                <ToggleServiceEditor
                  name={AI_SERVICE_NAMES.stickerNaming}
                  description="在“表情包”设置页，每个表情条目里可点击“AI 取名”，将图片按系统提示词交给模型生成新名称并自动改名。"
                  idPrefix="sn"
                  enabled={!!snCfg.enabled}
                  onToggle={(value) => controller.actions.setStickerNamingEnabled?.(value)}
                  sourceValue={aiServiceSourceValue(snSelection.sourceKind, snSelection.sourceId)}
                  onSourceChange={(value) => controller.actions.setStickerNamingModelSource?.(value)}
                  selection={snSelection}
                  onModelChange={(value) => controller.actions.setStickerNamingModelId?.(value)}
                  promptValue={typeof snCfg.systemPrompt === 'string' ? snCfg.systemPrompt : ''}
                  onPromptChange={(value) => controller.actions.setStickerNamingSystemPrompt?.(value)}
                  defaultPrompt={String(controller?.defaults?.stickerNamingSystemPrompt || '')}
                  onResetPrompt={() => controller.actions.resetStickerNamingSystemPromptDefault?.()}
                  promptMinRows={6}
                  loading={loading}
                  sourceSelectDisabled={sourceSelectDisabled}
                  providers={providers}
                  modelGroups={modelGroupList}
                />
              ) : null}
            </CustomScrollArea>
          </Box>
        </Stack>
      </Stack>
    </SettingsSurface>
  )
}

function ServiceModelPicker(props: {
  idPrefix: string
  sourceValue: string
  onSourceChange: (value: string) => void
  selection: any
  onModelChange: (value: string) => void
  loading: boolean
  sourceSelectDisabled: boolean
  providers: any[]
  modelGroups: any[]
}) {
  const { idPrefix, sourceValue, onSourceChange, selection, onModelChange, loading, sourceSelectDisabled, providers, modelGroups } = props
  return (
    <Stack spacing={1.25}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
        <FormControl size="small" fullWidth>
          <InputLabel id={`${idPrefix}-source`}>模型来源</InputLabel>
          <Select
            labelId={`${idPrefix}-source`}
            value={sourceValue}
            label="模型来源"
            onChange={(e) => onSourceChange(e.target.value)}
            disabled={sourceSelectDisabled}
          >
            {aiServiceSourceSelectItems(providers, modelGroups)}
          </Select>
        </FormControl>

        <FormControl size="small" fullWidth>
          <InputLabel id={`${idPrefix}-model`}>登记模型</InputLabel>
          <Select
            labelId={`${idPrefix}-model`}
            value={selection.hasPickInList ? selection.modelPick : ''}
            label="登记模型"
            onChange={(e) => onModelChange(e.target.value)}
            disabled={loading || !selection.sourceId}
          >
            <MenuItem value="">
              <em>请选择…</em>
            </MenuItem>
            {selection.modelItems.map((item: any) => (
              <MenuItem key={item.id} value={item.id}>
                {item.hint ? `${item.label} / ${item.hint}` : item.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      <Typography variant="caption" color="text.secondary">
        可选择供应商设置中已登记的模型，也可选择模型组中的对外模型。
      </Typography>
    </Stack>
  )
}

function ServicePromptSection(props: {
  value: string
  onChange: (value: string) => void
  defaultPrompt: string
  onReset: () => void
  minRows: number
  disabled?: boolean
}) {
  const { value, onChange, defaultPrompt, onReset, minRows, disabled } = props
  const changed = !!defaultPrompt && value.trim() !== defaultPrompt.trim()
  return (
    <SettingsSection>
      <Stack spacing={1.25}>
        <Typography sx={{ fontWeight: 900 }}>系统提示词</Typography>
        <TextField
          size="small"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="写入系统提示词…"
          fullWidth
          multiline
          minRows={minRows}
          disabled={disabled}
        />
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="caption" color={changed ? 'warning.main' : 'text.secondary'}>
            {changed ? '已自定义系统提示词' : '当前为默认系统提示词'}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button size="small" variant="text" onClick={onReset} disabled={!defaultPrompt || !changed}>
            恢复默认
          </Button>
        </Stack>
      </Stack>
    </SettingsSection>
  )
}

function ToggleServiceEditor(props: {
  name: string
  description: string
  idPrefix: string
  enabled: boolean
  onToggle: (value: boolean) => void
  sourceValue: string
  onSourceChange: (value: string) => void
  selection: any
  onModelChange: (value: string) => void
  promptValue: string
  onPromptChange: (value: string) => void
  defaultPrompt: string
  onResetPrompt: () => void
  promptMinRows: number
  loading: boolean
  sourceSelectDisabled: boolean
  providers: any[]
  modelGroups: any[]
}) {
  const { name, description, idPrefix, enabled, onToggle, sourceValue, onSourceChange, selection, onModelChange, promptValue, onPromptChange, defaultPrompt, onResetPrompt, promptMinRows, loading, sourceSelectDisabled, providers, modelGroups } = props
  return (
    <Stack spacing={1.25}>
      <SettingsSection>
        <Stack spacing={1.25}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography sx={{ fontWeight: 900 }}>{name}</Typography>
            <Box sx={{ flex: 1 }} />
            <Stack direction="row" alignItems="center" spacing={1}>
              <Switch size="small" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
              <Typography variant="body2" color="text.secondary">
                启用
              </Typography>
            </Stack>
          </Stack>

          <Typography variant="caption" color="text.secondary">
            {description}
          </Typography>

          <ServiceModelPicker
            idPrefix={idPrefix}
            sourceValue={sourceValue}
            onSourceChange={onSourceChange}
            selection={selection}
            onModelChange={onModelChange}
            loading={loading}
            sourceSelectDisabled={sourceSelectDisabled}
            providers={providers}
            modelGroups={modelGroups}
          />
        </Stack>
      </SettingsSection>

      <ServicePromptSection
        value={promptValue}
        onChange={onPromptChange}
        defaultPrompt={defaultPrompt}
        onReset={onResetPrompt}
        minRows={promptMinRows}
      />
    </Stack>
  )
}

function ContextCompressionEditor(props: {
  controller: any
  loading: boolean
  config: any
  selection: any
  providers: any[]
  modelGroups: any[]
  sourceSelectDisabled: boolean
}) {
  const { controller, loading, config, selection, providers, modelGroups, sourceSelectDisabled } = props
  const retainRecentMessages = Math.round(
    clampNum(
      Number(config.retainRecentMessages ?? DEFAULT_CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES),
      CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MIN,
      CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MAX,
    ),
  )
  return (
    <SettingsSection>
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography sx={{ fontWeight: 900 }}>上下文压缩</Typography>
          <Box sx={{ flex: 1 }} />
          <SettingsPill>/compact</SettingsPill>
        </Stack>

        <Typography variant="caption" color="text.secondary">
          手动输入 /compact 时，用这里选择的模型把较早聊天整理成摘要；原始消息仍保留，只影响后续发给模型的上下文。
        </Typography>

        <ServiceModelPicker
          idPrefix="context-compression"
          sourceValue={aiServiceSourceValue(selection.sourceKind, selection.sourceId)}
          onSourceChange={(value) => controller.actions.setContextCompressionModelSource?.(value)}
          selection={selection}
          onModelChange={(value) => controller.actions.setContextCompressionModelId?.(value)}
          loading={loading}
          sourceSelectDisabled={sourceSelectDisabled}
          providers={providers}
          modelGroups={modelGroups}
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" sx={{ fontWeight: 900 }}>
                压缩后保留最近原文
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Typography variant="caption" color="text.secondary">
                {Math.round(retainRecentMessages)} 条
              </Typography>
            </Stack>
            <Slider
              size="small"
              value={retainRecentMessages}
              min={CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MIN}
              max={CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MAX}
              step={1}
              onChange={(_e, v) => controller.actions.setContextCompressionRetainRecentMessages?.(Array.isArray(v) ? v[0] : v)}
              disabled={loading}
            />
          </Box>

          <TextField
            size="small"
            type="number"
            label="保留条数"
            value={Math.round(retainRecentMessages)}
            onChange={(e) => controller.actions.setContextCompressionRetainRecentMessages?.(e.target.value)}
            inputProps={{
              min: CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MIN,
              max: CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MAX,
              step: 1,
            }}
            disabled={loading}
            sx={{ width: { xs: '100%', sm: 150 } }}
          />
        </Stack>
      </Stack>
    </SettingsSection>
  )
}
