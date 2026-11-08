import { clamp, uid } from '../../core/utils'
import {
  BASE_COLOR_KEYS,
  COLOR_THEME_SETTING_KEY,
  cloneColorThemeDraft,
  listColorThemePresets,
  materializeColorThemePreset,
  normalizeColorThemeSettings,
  parseColorThemePresetImport,
  uniqueColorThemePresetName,
  type ColorThemeDraft,
  type ColorThemePreset,
} from '../../domain/colorTheme'
import { normalizeChatFontFamily, normalizeChatFontSize, normalizeChatLetterSpacing, normalizeChatLineHeight } from '../../domain/chatFont'
import { normalizeComposerMinRows, normalizeComposerModelShowProvider, normalizeComposerRadius, normalizeComposerWidthPercent } from '../../domain/composerAppearance'
import {
  normalizeChatBgBlur,
  normalizeChatBgOpacity,
  normalizeComposerBlur,
  normalizeComposerOpacity,
  normalizeTopbarBlur,
  normalizeTopbarOpacity,
} from '../../domain/appearanceSettings'
import {
  normalizeBranchTreeDir,
  normalizeBranchTreeSettings,
  normalizeBranchTreeView,
} from '../../domain/branchTree'
import { normalizeSettingsNavOrder } from '../../domain/settingsNavigation'
import { normalizeReasoningDisplayMode, normalizeReasoningRenderEnabled } from '../../domain/reasoningDisplay'
import { normalizeMessageOffscreenSkipEnabled } from '../../domain/messageOffscreen'
import { normalizeSessionKeepAliveLimit } from '../../domain/sessionKeepAlive'
import { applySidebarSide, applySidebarWidth, resolveSidebarLayout, SIDEBAR_LAYOUT_SETTING_KEY } from '../../domain/sidebarLayout'
import type { AiChatShowToast } from '../../gateway/capabilities'
import { refreshScopes } from '../../domain/uiRefreshScope'

export function createAppearanceActions(deps: {
  state: any
  emit: () => void
  emitScope?: (scope: string) => void
  saveMeta: () => Promise<any>
  showToast?: AiChatShowToast
  currentRenderSafetyPolicy: () => string
}) {
  const { state, emit, emitScope, saveMeta, showToast, currentRenderSafetyPolicy } = deps

  // 外观 / 主题 / 字体 / 壁纸 / 输入区 / 树设置：统一归到 settings 地址。
  function notifySettings() {
    if (emitScope) {
      emitScope(refreshScopes.settings())
      return
    }
    emit()
  }

  // 外观开关是用户操作，保存失败必须可见：统一经这里上报，不再静默吞错。
  const persistMeta = () => {
    void saveMeta().catch((error: any) => {
      showToast?.(String(error?.message || error || '保存外观设置失败'), { kind: 'error' })
    })
  }

  // 分支树设置只允许经领域归一化建立/读取，避免动作层自带一份默认值。
  const currentBranchTree = () => {
    if (!state.data) return null
    if (!state.data.settings || typeof state.data.settings !== 'object') state.data.settings = {} as any
    const next = normalizeBranchTreeSettings((state.data.settings as any).branchTree)
    ;(state.data.settings as any).branchTree = next
    return next
  }

  // 配色草稿：设置页未保存的编辑层。首次操作时从当前设置克隆；保存按单个预设物化落盘。
  const ensureColorThemeDraft = (): ColorThemeDraft => {
    const existing = (state.draft as any).colorThemeDraft as ColorThemeDraft | null
    if (existing) return existing
    const draft = cloneColorThemeDraft((state.data?.settings as any)?.[COLOR_THEME_SETTING_KEY])
    ;(state.draft as any).colorThemeDraft = draft
    return draft
  }

  return {
    setSideTab: (tab: any) => {
      state.sideTab = tab === 'chats' ? 'chats' : 'roles'
      notifySettings()
    },
    setChatBgOpacity: (opacity: any, commit: any) => {
      if (!state.data) return
      state.data.settings.chatBgOpacity = normalizeChatBgOpacity(opacity)
      if (commit) persistMeta()
      notifySettings()
    },
    setChatBgBlur: (blur: any, commit: any) => {
      if (!state.data) return
      state.data.settings.chatBgBlur = normalizeChatBgBlur(blur)
      if (commit) persistMeta()
      notifySettings()
    },
    setTopbarOpacity: (opacity: any, commit: any) => {
      if (!state.data) return
      state.data.settings.topbarOpacity = normalizeTopbarOpacity(opacity)
      if (commit) persistMeta()
      notifySettings()
    },
    setTopbarBlur: (blur: any, commit: any) => {
      if (!state.data) return
      state.data.settings.topbarBlur = normalizeTopbarBlur(blur)
      if (commit) persistMeta()
      notifySettings()
    },
    setComposerOpacity: (opacity: any, commit: any) => {
      if (!state.data) return
      state.data.settings.composerOpacity = normalizeComposerOpacity(opacity)
      if (commit) persistMeta()
      notifySettings()
    },
    setComposerBlur: (blur: any, commit: any) => {
      if (!state.data) return
      state.data.settings.composerBlur = normalizeComposerBlur(blur)
      if (commit) persistMeta()
      notifySettings()
    },
    setComposerWidthPercent: (percent: any, commit: any) => {
      if (!state.data) return
      state.data.settings.composerWidthPercent = normalizeComposerWidthPercent(percent)
      if (commit) persistMeta()
      notifySettings()
    },
    setComposerMinRows: (rows: any, commit: any) => {
      if (!state.data) return
      state.data.settings.composerMinRows = normalizeComposerMinRows(rows)
      if (commit) persistMeta()
      notifySettings()
    },
    setComposerRadius: (radius: any, commit: any) => {
      if (!state.data) return
      state.data.settings.composerRadius = normalizeComposerRadius(radius)
      if (commit) persistMeta()
      notifySettings()
    },
    setComposerModelShowProvider: (enabled: any) => {
      if (!state.data) return
      state.data.settings.composerModelShowProvider = normalizeComposerModelShowProvider(enabled)
      persistMeta()
      notifySettings()
    },
    setChatFontSize: (size: any, commit: any) => {
      if (!state.data) return
      state.data.settings.chatFontSize = normalizeChatFontSize(size)
      if (commit) persistMeta()
      notifySettings()
    },
    setChatFontFamily: (family: any) => {
      if (!state.data) return
      state.data.settings.chatFontFamily = normalizeChatFontFamily(family)
      persistMeta()
      notifySettings()
    },
    setChatLetterSpacing: (spacing: any, commit: any) => {
      if (!state.data) return
      state.data.settings.chatLetterSpacing = normalizeChatLetterSpacing(spacing)
      if (commit) persistMeta()
      notifySettings()
    },
    setChatLineHeight: (height: any, commit: any) => {
      if (!state.data) return
      state.data.settings.chatLineHeight = normalizeChatLineHeight(height)
      if (commit) persistMeta()
      notifySettings()
    },
    // 配色草稿动作：选中 / 改色 / 改名 / 新增 / 导入都先建立草稿并实时预览；
    // saveColorThemeDraftPreset 按单个预设保存（内置改动生成副本，导入预设原地更新），
    // 其他预设的未保存修改保留在草稿里。

    selectColorThemeDraftPreset: (presetId: any) => {
      if (!state.data) return false
      const id = String(presetId || '').trim()
      const settings = normalizeColorThemeSettings((state.data.settings as any)[COLOR_THEME_SETTING_KEY])
      const existsInSaved = listColorThemePresets(settings).some((preset) => preset.id === id)
      const draft = (state.draft as any).colorThemeDraft as ColorThemeDraft | null
      const existsInDraft = !!draft && draft.presets.some((preset) => preset.id === id)
      if (!existsInSaved && !existsInDraft) {
        showToast?.('配色预设不存在', { kind: 'error' })
        return false
      }
      // 切换到已保存预设属于使用行为：即时生效落盘，不产生未保存标记。
      if (existsInSaved && settings.activePresetId !== id) {
        ;(state.data.settings as any)[COLOR_THEME_SETTING_KEY] = { ...settings, activePresetId: id }
        persistMeta()
      }
      if (draft) draft.activePresetId = id
      notifySettings()
      return true
    },
    updateColorThemeDraftColor: (presetId: any, colorKey: any, value: any) => {
      if (!state.data) return false
      const key = String(colorKey || '')
      if (!(BASE_COLOR_KEYS as readonly string[]).includes(key)) return false
      const preset = ensureColorThemeDraft().presets.find((item) => item.id === String(presetId || ''))
      const next = String(value ?? '').trim()
      if (!preset || !next) return false
      ;(preset.baseColors as any)[key] = next
      notifySettings()
      return true
    },
    renameColorThemeDraftPreset: (presetId: any, name: any) => {
      if (!state.data) return false
      const preset = ensureColorThemeDraft().presets.find((item) => item.id === String(presetId || ''))
      if (!preset) return false
      preset.name = String(name ?? '')
      notifySettings()
      return true
    },
    addColorThemeDraftPreset: () => {
      if (!state.data) return false
      const draft = ensureColorThemeDraft()
      const current = draft.presets.find((preset) => preset.id === draft.activePresetId) || draft.presets[0]
      if (!current) return false
      const preset: ColorThemePreset = {
        id: `draft-${uid('color_theme')}`,
        name: uniqueColorThemePresetName('新配色', new Set(draft.presets.map((item) => item.name))),
        description: '',
        mode: current.mode === 'dark' ? 'dark' : 'light',
        baseColors: { ...current.baseColors },
      }
      draft.presets.push(preset)
      draft.activePresetId = preset.id
      notifySettings()
      return true
    },
    importColorThemePresets: (jsonText: any) => {
      if (!state.data) return false
      try {
        const parsed = parseColorThemePresetImport(String(jsonText || ''), () => uid('color_theme'))
        const draft = ensureColorThemeDraft()
        const usedNames = new Set(draft.presets.map((preset) => preset.name))
        const appended = parsed.map((preset) => {
          const name = uniqueColorThemePresetName(preset.name, usedNames)
          usedNames.add(name)
          return { ...preset, id: `draft-${preset.id}`, name }
        })
        draft.presets.push(...appended)
        draft.activePresetId = appended[0].id
        emit()
        showToast?.(`已加入 ${appended.length} 个配色预设，保存后生效`, { kind: 'success' })
        return true
      } catch (error: any) {
        showToast?.(String(error?.message || error || '导入配色失败'), { kind: 'error' })
        return false
      }
    },
    saveColorThemeDraftPreset: (presetId: any) => {
      if (!state.data) return false
      const draft = (state.draft as any).colorThemeDraft as ColorThemeDraft | null
      if (!draft) return false
      const result = materializeColorThemePreset(
        (state.data.settings as any)[COLOR_THEME_SETTING_KEY],
        draft,
        String(presetId || '').trim(),
        () => uid('color_theme'),
      )
      if (!result) return false
      ;(state.data.settings as any)[COLOR_THEME_SETTING_KEY] = result.settings
      ;(state.draft as any).colorThemeDraft = result.draft
      persistMeta()
      notifySettings()
      showToast?.('配色已保存', { kind: 'success' })
      return true
    },
    requestSetRenderSafetyPolicy: (policy: any) => {
      if (!state.data) return
      const raw = String(policy || '').trim()
      const next = raw === 'unsafe' ? 'unsafe' : raw === 'baseline' ? 'baseline' : 'original'
      const cur = currentRenderSafetyPolicy()
      if (next === cur) return
      if (next === 'unsafe') {
        ;(state.draft as any).renderSafetyPolicyTarget = next
        state.modal = 'confirm'
        emit()
        return
      }
      ;(state.data.settings as any).renderSafetyPolicy = next
      persistMeta()
      notifySettings()
    },
    setBranchTreeDir: (dir: any) => {
      const branchTree = currentBranchTree()
      if (!branchTree) return
      branchTree.dir = normalizeBranchTreeDir(dir)
      persistMeta()
      notifySettings()
    },
    setBranchTreeView: (view: any) => {
      const branchTree = currentBranchTree()
      if (!branchTree) return
      branchTree.view = normalizeBranchTreeView(view)
      persistMeta()
      notifySettings()
    },
    setBranchTreeFollowSelected: (enabled: any) => {
      const branchTree = currentBranchTree()
      if (!branchTree) return
      branchTree.followSelected = !!enabled
      persistMeta()
      notifySettings()
    },
    setBranchTreeModalHotkey: (hotkey: any) => {
      const branchTree = currentBranchTree()
      if (!branchTree) return
      branchTree.modalHotkey = normalizeBranchTreeSettings({ modalHotkey: hotkey }).modalHotkey
      persistMeta()
      notifySettings()
    },
    setSettingsNavOrder: (order: any) => {
      if (!state.data || !Array.isArray(order)) return
      if (!state.data.settings || typeof state.data.settings !== 'object') state.data.settings = {} as any
      ;(state.data.settings as any).settingsNavOrder = normalizeSettingsNavOrder(order)
      persistMeta()
      notifySettings()
    },
    toggleUserMessageCollapse: () => {
      if (!state.data) return
      state.data.settings.userMessageCollapseEnabled = !state.data.settings.userMessageCollapseEnabled
      persistMeta()
      notifySettings()
    },
    setUserMessageCollapseLines: (lines: any, commit: any) => {
      if (!state.data) return
      state.data.settings.userMessageCollapseLines = clamp(Math.round(Number(lines || 8)), 1, 50)
      if (commit) persistMeta()
      notifySettings()
    },
    setReasoningDisplayMode: (mode: any) => {
      if (!state.data) return
      state.data.settings.reasoningDisplayMode = normalizeReasoningDisplayMode(mode)
      persistMeta()
      notifySettings()
    },
    setReasoningRenderEnabled: (enabled: any) => {
      if (!state.data) return
      state.data.settings.reasoningRenderEnabled = normalizeReasoningRenderEnabled(enabled)
      persistMeta()
      notifySettings()
    },
    setMessageOffscreenSkipEnabled: (enabled: any) => {
      if (!state.data) return
      state.data.settings.messageOffscreenSkipEnabled = normalizeMessageOffscreenSkipEnabled(enabled)
      persistMeta()
      notifySettings()
    },
    // 会话页面保活上限：虚拟化后单页成本下降，允许用户把常驻页数调大。
    setSessionKeepAliveLimit: (limit: any) => {
      if (!state.data) return
      ;(state.data.settings as any).sessionKeepAliveLimit = normalizeSessionKeepAliveLimit(limit)
      persistMeta()
      notifySettings()
    },
    // 侧边栏布局是两个身份 A / B 各一份：侧别互斥（改一侧，另一侧翻到对侧），宽度独立。
    setSidebarSide: (id: any, side: any) => {
      if (!state.data) return
      const next = applySidebarSide(resolveSidebarLayout(state.data.settings as any), id, side)
      ;(state.data.settings as any)[SIDEBAR_LAYOUT_SETTING_KEY] = next
      persistMeta()
      notifySettings()
    },
    setSidebarWidth: (id: any, width: any) => {
      if (!state.data) return
      const next = applySidebarWidth(resolveSidebarLayout(state.data.settings as any), id, width)
      ;(state.data.settings as any)[SIDEBAR_LAYOUT_SETTING_KEY] = next
      persistMeta()
      notifySettings()
    },
  }
}
