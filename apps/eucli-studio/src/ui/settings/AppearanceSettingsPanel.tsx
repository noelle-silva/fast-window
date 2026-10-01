import * as React from 'react'
import { Box, Button, FormControl, InputLabel, MenuItem, Select, Slider, Stack, Switch, TextField, Typography } from '@mui/material'
import { hotkeyFromKeyEvent, normalizeHotkeyString } from '../utils/hotkeys'
import { clampNum } from '../utils/numbers'
import {
  CHAT_FONT_OPTIONS,
  CHAT_FONT_SIZE_MAX,
  CHAT_FONT_SIZE_MIN,
  CHAT_LETTER_SPACING_MAX,
  CHAT_LETTER_SPACING_MIN,
  CHAT_LINE_HEIGHT_MAX,
  CHAT_LINE_HEIGHT_MIN,
  chatFontFamilyLabel,
  chatFontFamilyStack,
  normalizeChatFontFamily,
  normalizeChatFontSize,
  normalizeChatLetterSpacing,
  normalizeChatLineHeight,
} from '../../domain/chatFont'
import { REASONING_DISPLAY_MODE_OPTIONS, normalizeReasoningDisplayMode, normalizeReasoningRenderEnabled } from '../../domain/reasoningDisplay'
import {
  COMPOSER_MIN_ROWS_MAX,
  COMPOSER_MIN_ROWS_MIN,
  COMPOSER_RADIUS_MAX,
  COMPOSER_RADIUS_MIN,
  COMPOSER_WIDTH_PERCENT_MAX,
  COMPOSER_WIDTH_PERCENT_MIN,
  normalizeComposerMinRows,
  normalizeComposerRadius,
  normalizeComposerWidthPercent,
} from '../../domain/composerAppearance'
import type { AiChatToastOptions } from '../../gateway/capabilities'
import { ColorThemeSettingsSection } from './ColorThemeSettingsSection'
import { WallpaperSettingsSection } from './WallpaperSettingsSection'
import { SettingsSection, SettingsSurface } from './SettingsSurfaces'

// useNumberDraft 管理「数字输入框 + 滑杆」组合的输入草稿：输入过程不打断，
// 提交时归一化并复位显示；与设置值同步，滑杆拖动不会和输入框打架。
function useNumberDraft(value: number, normalize: (raw: unknown) => number, commitValue: (next: number) => void) {
  const [draft, setDraft] = React.useState(() => String(value))

  React.useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commitDraft = () => {
    const next = normalize(draft)
    setDraft(String(next))
    if (next !== value) commitValue(next)
  }

  return { draft, setDraft, commitDraft }
}

function ChatTextMetricRow(props: {
  label: string
  unit: string
  min: number
  max: number
  step: number
  value: number
  draft: string
  disabled: boolean
  onDraftChange: (text: string) => void
  onCommitDraft: () => void
  onValueChange: (value: number, commit: boolean) => void
}) {
  const { label, unit, min, max, step, value, draft, disabled, onDraftChange, onCommitDraft, onValueChange } = props
  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="body2" sx={{ fontWeight: 900 }}>
          {label}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <TextField
          size="small"
          type="number"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={onCommitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitDraft()
          }}
          inputProps={{ min, max, step }}
          disabled={disabled}
          sx={{ width: 84, '& input': { textAlign: 'right' } }}
        />
        <Typography variant="caption" color="text.secondary">
          {unit}
        </Typography>
      </Stack>
      <Slider
        size="small"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(_e, v) => onValueChange(Number(v), false)}
        onChangeCommitted={(_e, v) => onValueChange(Number(v), true)}
        disabled={disabled}
      />
    </Box>
  )
}

export function AppearanceSettingsPanel(props: { controller: any; loading: boolean; data: any }) {
  const { controller, loading, data } = props
  const settings = data?.settings
  const [treeHotkeyRecording, setTreeHotkeyRecording] = React.useState(false)
  const chatFontSize = normalizeChatFontSize(settings?.chatFontSize)
  const chatFontFamily = normalizeChatFontFamily(settings?.chatFontFamily)
  const chatLetterSpacing = normalizeChatLetterSpacing(settings?.chatLetterSpacing)
  const chatLineHeight = normalizeChatLineHeight(settings?.chatLineHeight)
  const fontSizeDraft = useNumberDraft(chatFontSize, normalizeChatFontSize, (next) => controller.actions.setChatFontSize?.(next, true))
  const letterSpacingDraft = useNumberDraft(chatLetterSpacing, normalizeChatLetterSpacing, (next) => controller.actions.setChatLetterSpacing?.(next, true))
  const lineHeightDraft = useNumberDraft(chatLineHeight, normalizeChatLineHeight, (next) => controller.actions.setChatLineHeight?.(next, true))

  React.useEffect(() => {
    if (!treeHotkeyRecording) return
    const toast = (s: string, options?: AiChatToastOptions) => controller?.capabilities?.ui?.showToast?.(s, options)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if ((e as any).isComposing) return

      const key = String(e.key || '')
      if (key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setTreeHotkeyRecording(false)
        toast('已取消录制', { kind: 'success' })
        return
      }

      const hk = hotkeyFromKeyEvent(e)
      if (!hk) return

      const hasMainMod = !!(e.ctrlKey || e.altKey || e.metaKey)
      if (!hasMainMod) {
        e.preventDefault()
        e.stopPropagation()
        toast('请使用 Ctrl / Alt / Meta + 任意键', { kind: 'error' })
        return
      }

      e.preventDefault()
      e.stopPropagation()
      setTreeHotkeyRecording(false)
      controller.actions.setBranchTreeModalHotkey?.(hk)
      toast(`快捷键已设置：${hk}`, { kind: 'success' })
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [treeHotkeyRecording, controller])

  const transparentChatBg = !!settings?.transparentChatBg
  const chatBgOpacity = clampNum(Number(settings?.chatBgOpacity ?? 0), 0, 100)
  const chatBgBlur = clampNum(Number(settings?.chatBgBlur ?? 0), 0, 24)
  const topbarOpacity = clampNum(Number(settings?.topbarOpacity ?? 100), 0, 100)
  const topbarBlur = clampNum(Number(settings?.topbarBlur ?? 0), 0, 24)
  const composerOpacity = clampNum(Number(settings?.composerOpacity ?? 86), 40, 100)
  const composerBlur = clampNum(Number(settings?.composerBlur ?? 10), 0, 24)
  const composerWidthPercent = normalizeComposerWidthPercent(settings?.composerWidthPercent)
  const composerMinRows = normalizeComposerMinRows(settings?.composerMinRows)
  const composerRadius = normalizeComposerRadius(settings?.composerRadius)
  const composerWidthDraft = useNumberDraft(composerWidthPercent, normalizeComposerWidthPercent, (next) => controller.actions.setComposerWidthPercent?.(next, true))
  const composerMinRowsDraft = useNumberDraft(composerMinRows, normalizeComposerMinRows, (next) => controller.actions.setComposerMinRows?.(next, true))
  const composerRadiusDraft = useNumberDraft(composerRadius, normalizeComposerRadius, (next) => controller.actions.setComposerRadius?.(next, true))
  const renderSafetyPolicy = (() => {
    const v = String((settings as any)?.renderSafetyPolicy || 'original').trim()
    return v === 'unsafe' ? 'unsafe' : v === 'baseline' ? 'baseline' : 'original'
  })()
  const userMessageCollapseEnabled = !!settings?.userMessageCollapseEnabled
  const userMessageCollapseLines = clampNum(Number(settings?.userMessageCollapseLines ?? 8), 1, 50)
  const reasoningDisplayMode = normalizeReasoningDisplayMode(settings?.reasoningDisplayMode)
  const reasoningRenderEnabled = normalizeReasoningRenderEnabled(settings?.reasoningRenderEnabled)
  const branchTreeView = (() => {
    const raw = String(((settings as any)?.branchTree?.view ?? '') as any).trim()
    return raw === 'right' || raw === 'float' ? raw : 'right'
  })()
  const branchTreeFollowSelected = (() => {
    const raw = (settings as any)?.branchTree?.followSelected
    return typeof raw === 'boolean' ? raw : true
  })()
  const branchTreeModalHotkey = (() => {
    const raw = String(((settings as any)?.branchTree?.modalHotkey ?? '') as any).trim()
    return normalizeHotkeyString(raw)
  })()

  return (
    <SettingsSurface>
      <Stack spacing={1.5}>
        <Typography sx={{ fontWeight: 900 }}>客户端外观</Typography>

        <ColorThemeSettingsSection controller={controller} loading={loading} settings={settings} />

        <WallpaperSettingsSection controller={controller} loading={loading} settings={settings} />

        <SettingsSection>
          <Stack spacing={1.25}>
            <Box>
              <Typography sx={{ fontWeight: 900 }}>会话文字</Typography>
              <Typography variant="caption" color="text.secondary">
                调整会话消息与输入框的文字；代码块与工具原始内容保持等宽字体。
              </Typography>
            </Box>

            <ChatTextMetricRow
              label="字体大小"
              unit="px"
              min={CHAT_FONT_SIZE_MIN}
              max={CHAT_FONT_SIZE_MAX}
              step={1}
              value={chatFontSize}
              draft={fontSizeDraft.draft}
              disabled={loading}
              onDraftChange={fontSizeDraft.setDraft}
              onCommitDraft={fontSizeDraft.commitDraft}
              onValueChange={(v, commit) => controller.actions.setChatFontSize?.(v, commit)}
            />

            <ChatTextMetricRow
              label="字间距"
              unit="px"
              min={CHAT_LETTER_SPACING_MIN}
              max={CHAT_LETTER_SPACING_MAX}
              step={0.1}
              value={chatLetterSpacing}
              draft={letterSpacingDraft.draft}
              disabled={loading}
              onDraftChange={letterSpacingDraft.setDraft}
              onCommitDraft={letterSpacingDraft.commitDraft}
              onValueChange={(v, commit) => controller.actions.setChatLetterSpacing?.(v, commit)}
            />

            <ChatTextMetricRow
              label="行间距"
              unit="倍"
              min={CHAT_LINE_HEIGHT_MIN}
              max={CHAT_LINE_HEIGHT_MAX}
              step={0.05}
              value={chatLineHeight}
              draft={lineHeightDraft.draft}
              disabled={loading}
              onDraftChange={lineHeightDraft.setDraft}
              onCommitDraft={lineHeightDraft.commitDraft}
              onValueChange={(v, commit) => controller.actions.setChatLineHeight?.(v, commit)}
            />

            <Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 900 }}>
                    字体
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    下拉项按各自字体预览；系统未安装的字体将自动回落。
                  </Typography>
                </Box>
                <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 220 } }}>
                  <InputLabel id="fw-chat-font-family">会话字体</InputLabel>
                  <Select
                    labelId="fw-chat-font-family"
                    label="会话字体"
                    value={chatFontFamily}
                    onChange={(e) => controller.actions.setChatFontFamily?.(String(e.target.value || ''))}
                    disabled={loading}
                    renderValue={(value) => (
                      <Box component="span" sx={{ fontFamily: chatFontFamilyStack(String(value || '')) }}>
                        {chatFontFamilyLabel(String(value || ''))}
                      </Box>
                    )}
                  >
                    {CHAT_FONT_OPTIONS.map((option) => (
                      <MenuItem key={option.value || '__default__'} value={option.value} sx={{ fontFamily: chatFontFamilyStack(option.value) }}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
            </Box>
          </Stack>
        </SettingsSection>

        <SettingsSection>
          <Stack spacing={1.25}>
            <Box>
              <Typography sx={{ fontWeight: 900 }}>输入区尺寸</Typography>
              <Typography variant="caption" color="text.secondary">
                调整底部输入栏的宽度、输入框高度与圆角；外框与输入框共用同一圆角。
              </Typography>
            </Box>

            <ChatTextMetricRow
              label="输入栏宽度"
              unit="%"
              min={COMPOSER_WIDTH_PERCENT_MIN}
              max={COMPOSER_WIDTH_PERCENT_MAX}
              step={1}
              value={composerWidthPercent}
              draft={composerWidthDraft.draft}
              disabled={loading}
              onDraftChange={composerWidthDraft.setDraft}
              onCommitDraft={composerWidthDraft.commitDraft}
              onValueChange={(v, commit) => controller.actions.setComposerWidthPercent?.(v, commit)}
            />

            <ChatTextMetricRow
              label="输入框行数"
              unit="行"
              min={COMPOSER_MIN_ROWS_MIN}
              max={COMPOSER_MIN_ROWS_MAX}
              step={1}
              value={composerMinRows}
              draft={composerMinRowsDraft.draft}
              disabled={loading}
              onDraftChange={composerMinRowsDraft.setDraft}
              onCommitDraft={composerMinRowsDraft.commitDraft}
              onValueChange={(v, commit) => controller.actions.setComposerMinRows?.(v, commit)}
            />

            <ChatTextMetricRow
              label="圆角"
              unit="px"
              min={COMPOSER_RADIUS_MIN}
              max={COMPOSER_RADIUS_MAX}
              step={1}
              value={composerRadius}
              draft={composerRadiusDraft.draft}
              disabled={loading}
              onDraftChange={composerRadiusDraft.setDraft}
              onCommitDraft={composerRadiusDraft.commitDraft}
              onValueChange={(v, commit) => controller.actions.setComposerRadius?.(v, commit)}
            />
          </Stack>
        </SettingsSection>

        <SettingsSection>
          <Stack spacing={1.25}>
            <Box>
              <Typography sx={{ fontWeight: 900 }}>组件调节</Typography>
              {!transparentChatBg ? (
                <Typography variant="caption" color="text.secondary">
                  启用壁纸后这些调节才可使用。
                </Typography>
              ) : null}
            </Box>

            <Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ fontWeight: 900 }}>
                  聊天背景透明度
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  {Math.round(chatBgOpacity)}%
                </Typography>
              </Stack>
              <Slider
                size="small"
                value={chatBgOpacity}
                min={0}
                max={100}
                step={1}
                onChange={(_e, v) => controller.actions.setChatBgOpacity?.(v, false)}
                onChangeCommitted={(_e, v) => controller.actions.setChatBgOpacity?.(v, true)}
                disabled={loading || !transparentChatBg}
              />
            </Box>

            <Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ fontWeight: 900 }}>
                  聊天背景磨砂度
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  {Math.round(chatBgBlur)}px
                </Typography>
              </Stack>
              <Slider
                size="small"
                value={chatBgBlur}
                min={0}
                max={24}
                step={1}
                onChange={(_e, v) => controller.actions.setChatBgBlur?.(v, false)}
                onChangeCommitted={(_e, v) => controller.actions.setChatBgBlur?.(v, true)}
                disabled={loading || !transparentChatBg}
              />
            </Box>

            <Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ fontWeight: 900 }}>
                  顶部栏透明度
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  {Math.round(topbarOpacity)}%
                </Typography>
              </Stack>
              <Slider
                size="small"
                value={topbarOpacity}
                min={0}
                max={100}
                step={1}
                onChange={(_e, v) => controller.actions.setTopbarOpacity?.(v, false)}
                onChangeCommitted={(_e, v) => controller.actions.setTopbarOpacity?.(v, true)}
                disabled={loading || !transparentChatBg}
              />
            </Box>

            <Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ fontWeight: 900 }}>
                  顶部栏磨砂度
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  {Math.round(topbarBlur)}px
                </Typography>
              </Stack>
              <Slider
                size="small"
                value={topbarBlur}
                min={0}
                max={24}
                step={1}
                onChange={(_e, v) => controller.actions.setTopbarBlur?.(v, false)}
                onChangeCommitted={(_e, v) => controller.actions.setTopbarBlur?.(v, true)}
                disabled={loading || !transparentChatBg}
              />
            </Box>

            <Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ fontWeight: 900 }}>
                  输入栏透明度
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  {Math.round(composerOpacity)}%
                </Typography>
              </Stack>
              <Slider
                size="small"
                value={composerOpacity}
                min={40}
                max={100}
                step={1}
                onChange={(_e, v) => controller.actions.setComposerOpacity?.(v, false)}
                onChangeCommitted={(_e, v) => controller.actions.setComposerOpacity?.(v, true)}
                disabled={loading || !transparentChatBg}
              />
            </Box>

            <Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ fontWeight: 900 }}>
                  输入栏磨砂度
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  {Math.round(composerBlur)}px
                </Typography>
              </Stack>
              <Slider
                size="small"
                value={composerBlur}
                min={0}
                max={24}
                step={1}
                onChange={(_e, v) => controller.actions.setComposerBlur?.(v, false)}
                onChangeCommitted={(_e, v) => controller.actions.setComposerBlur?.(v, true)}
                disabled={loading || !transparentChatBg}
              />
            </Box>
          </Stack>
        </SettingsSection>

        <SettingsSection>
          <Stack spacing={1.25}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography sx={{ fontWeight: 900 }}>用户消息折叠</Typography>
              <Box sx={{ flex: 1 }} />
              <Stack direction="row" alignItems="center" spacing={1}>
                <Switch size="small" checked={userMessageCollapseEnabled} onChange={() => controller.actions.toggleUserMessageCollapse?.()} />
                <Typography variant="body2" color="text.secondary">
                  启用
                </Typography>
              </Stack>
            </Stack>

            <Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ fontWeight: 900 }}>
                  折叠行数
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  {Math.round(userMessageCollapseLines)} 行
                </Typography>
              </Stack>
              <Slider
                size="small"
                value={userMessageCollapseLines}
                min={1}
                max={50}
                step={1}
                onChange={(_e, v) => controller.actions.setUserMessageCollapseLines?.(v, false)}
                onChangeCommitted={(_e, v) => controller.actions.setUserMessageCollapseLines?.(v, true)}
                disabled={loading || !userMessageCollapseEnabled}
              />
              <Typography variant="caption" color="text.secondary">
                用户消息超过该行数时默认折叠，可在消息中展开/收起。
              </Typography>
            </Box>
          </Stack>
        </SettingsSection>

        <SettingsSection>
          <Stack spacing={1.25}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontWeight: 900 }}>思考过程显示</Typography>
                <Typography variant="caption" color="text.secondary">
                  AI 输出思考时思考过程的展开方式。
                </Typography>
              </Box>
              <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 220 } }}>
                <InputLabel id="fw-reasoning-display-mode">显示方式</InputLabel>
                <Select
                  labelId="fw-reasoning-display-mode"
                  label="显示方式"
                  value={reasoningDisplayMode}
                  onChange={(e) => controller.actions.setReasoningDisplayMode?.(String(e.target.value || ''))}
                  disabled={loading}
                >
                  {REASONING_DISPLAY_MODE_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>

            <Stack direction="row" spacing={1} alignItems="center">
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 900 }}>
                  思维链渲染
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  开启后思考内容按 Markdown 富文本渲染；关闭时按纯文本显示。
                </Typography>
              </Box>
              <Switch
                size="small"
                checked={reasoningRenderEnabled}
                onChange={(e) => controller.actions.setReasoningRenderEnabled?.(!!e.target.checked)}
                disabled={loading}
              />
            </Stack>
          </Stack>
        </SettingsSection>

        <SettingsSection>
          <Stack spacing={1.25}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography sx={{ fontWeight: 900 }}>分支树面板</Typography>
              <Box sx={{ flex: 1 }} />
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel id="fw-branch-tree-view">显示方式</InputLabel>
                <Select
                  labelId="fw-branch-tree-view"
                  label="显示方式"
                  value={branchTreeView}
                  onChange={(e) => controller.actions.setBranchTreeView?.(String(e.target.value || ''))}
                  disabled={loading}
                >
                  <MenuItem value="right">右侧面板</MenuItem>
                  <MenuItem value="float">悬浮模态窗</MenuItem>
                </Select>
              </FormControl>
            </Stack>

            <Stack direction="row" spacing={1} alignItems="center">
              <Switch
                size="small"
                checked={!!branchTreeFollowSelected}
                onChange={(e) => controller.actions.setBranchTreeFollowSelected?.(!!e.target.checked)}
                disabled={loading}
              />
              <Typography variant="body2" color="text.secondary">
                选中节点自动居中
              </Typography>
            </Stack>

            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                size="small"
                label="快捷键（打开模态窗）"
                value={branchTreeModalHotkey || ''}
                placeholder="未设置"
                disabled={loading}
                sx={{ flex: 1, minWidth: 0 }}
                InputProps={{ readOnly: true }}
              />
              <Button
                size="small"
                variant={treeHotkeyRecording ? 'contained' : 'text'}
                color={treeHotkeyRecording ? 'success' : 'inherit'}
                onClick={() => setTreeHotkeyRecording((v) => !v)}
                disabled={loading}
              >
                {treeHotkeyRecording ? '录制中…' : '录制'}
              </Button>
              <Button
                size="small"
                variant="text"
                color="inherit"
                onClick={() => controller.actions.setBranchTreeModalHotkey?.('')}
                disabled={loading || !branchTreeModalHotkey}
              >
                清除
              </Button>
            </Stack>
            {treeHotkeyRecording ? (
              <Typography variant="caption" color="text.secondary">
                按下组合键完成录制（建议 Ctrl/Alt/Meta + 任意键），按 Esc 取消。
              </Typography>
            ) : null}
            <Typography variant="caption" color="text.secondary">
              “右侧面板”会挤压聊天内容；“悬浮模态窗”会覆盖在当前界面上方。
            </Typography>
          </Stack>
        </SettingsSection>

        <SettingsSection>
          <Stack spacing={1.25}>
            <Typography sx={{ fontWeight: 900 }}>回复渲染安全</Typography>
            <FormControl size="small" fullWidth>
              <InputLabel id="render-safety-policy">策略</InputLabel>
              <Select
                labelId="render-safety-policy"
                label="策略"
                value={renderSafetyPolicy}
                onChange={(e) => controller.actions.requestSetRenderSafetyPolicy?.(String(e.target.value || 'original'))}
                disabled={loading}
              >
                <MenuItem value="original">默认模式</MenuItem>
                <MenuItem value="baseline">保留底线</MenuItem>
                <MenuItem value="unsafe">完全裸奔（极高风险）</MenuItem>
              </Select>
            </FormControl>
            <Typography variant="caption" color="text.secondary">
              影响 AI 回复中的 HTML、SVG、Mermaid 等富渲染限制。
            </Typography>
            <Typography variant="caption" color={renderSafetyPolicy === 'unsafe' ? 'warning.main' : 'text.secondary'}>
              {renderSafetyPolicy === 'unsafe'
                ? '当前是完全裸奔模式：不会再额外加这层 HTML / SVG / Mermaid 安全限制。'
                : renderSafetyPolicy === 'baseline'
                  ? '当前是保留底线模式：会放宽表现，但仍保留脚本、事件属性、javascript: 链接等最小限制。'
                  : '当前是默认模式：回到添加这次策略分级前的原始渲染行为。'}
            </Typography>
          </Stack>
        </SettingsSection>
      </Stack>
    </SettingsSurface>
  )
}
