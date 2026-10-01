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
import { normalizeComposerMinRows, normalizeComposerRadius, normalizeComposerWidthPercent } from '../../domain/composerAppearance'
import { normalizeReasoningDisplayMode, normalizeReasoningRenderEnabled } from '../../domain/reasoningDisplay'
import type { AiChatShowToast } from '../../gateway/capabilities'

export function createAppearanceActions(deps: {
  state: any
  emit: () => void
  saveMeta: () => Promise<any>
  showToast?: AiChatShowToast
  currentRenderSafetyPolicy: () => string
}) {
  const { state, emit, saveMeta, showToast, currentRenderSafetyPolicy } = deps

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
      emit()
    },
    setChatBgOpacity: (opacity: any, commit: any) => {
      if (!state.data) return
      state.data.settings.chatBgOpacity = clamp(Math.round(Number(opacity || 0)), 0, 100)
      if (commit) saveMeta().catch(() => {})
      emit()
    },
    setChatBgBlur: (blur: any, commit: any) => {
      if (!state.data) return
      state.data.settings.chatBgBlur = clamp(Math.round(Number(blur || 0)), 0, 24)
      if (commit) saveMeta().catch(() => {})
      emit()
    },
    setTopbarOpacity: (opacity: any, commit: any) => {
      if (!state.data) return
      state.data.settings.topbarOpacity = clamp(Math.round(Number(opacity || 0)), 0, 100)
      if (commit) saveMeta().catch(() => {})
      emit()
    },
    setTopbarBlur: (blur: any, commit: any) => {
      if (!state.data) return
      state.data.settings.topbarBlur = clamp(Math.round(Number(blur || 0)), 0, 24)
      if (commit) saveMeta().catch(() => {})
      emit()
    },
    setComposerOpacity: (opacity: any, commit: any) => {
      if (!state.data) return
      state.data.settings.composerOpacity = clamp(Math.round(Number(opacity || 0)), 40, 100)
      if (commit) saveMeta().catch(() => {})
      emit()
    },
    setComposerBlur: (blur: any, commit: any) => {
      if (!state.data) return
      state.data.settings.composerBlur = clamp(Math.round(Number(blur || 0)), 0, 24)
      if (commit) saveMeta().catch(() => {})
      emit()
    },
    setComposerWidthPercent: (percent: any, commit: any) => {
      if (!state.data) return
      state.data.settings.composerWidthPercent = normalizeComposerWidthPercent(percent)
      if (commit) saveMeta().catch(() => {})
      emit()
    },
    setComposerMinRows: (rows: any, commit: any) => {
      if (!state.data) return
      state.data.settings.composerMinRows = normalizeComposerMinRows(rows)
      if (commit) saveMeta().catch(() => {})
      emit()
    },
    setComposerRadius: (radius: any, commit: any) => {
      if (!state.data) return
      state.data.settings.composerRadius = normalizeComposerRadius(radius)
      if (commit) saveMeta().catch(() => {})
      emit()
    },
    setChatFontSize: (size: any, commit: any) => {
      if (!state.data) return
      state.data.settings.chatFontSize = normalizeChatFontSize(size)
      if (commit) saveMeta().catch(() => {})
      emit()
    },
    setChatFontFamily: (family: any) => {
      if (!state.data) return
      state.data.settings.chatFontFamily = normalizeChatFontFamily(family)
      saveMeta().catch(() => {})
      emit()
    },
    setChatLetterSpacing: (spacing: any, commit: any) => {
      if (!state.data) return
      state.data.settings.chatLetterSpacing = normalizeChatLetterSpacing(spacing)
      if (commit) saveMeta().catch(() => {})
      emit()
    },
    setChatLineHeight: (height: any, commit: any) => {
      if (!state.data) return
      state.data.settings.chatLineHeight = normalizeChatLineHeight(height)
      if (commit) saveMeta().catch(() => {})
      emit()
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
        saveMeta().catch(() => {})
      }
      if (draft) draft.activePresetId = id
      emit()
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
      emit()
      return true
    },
    renameColorThemeDraftPreset: (presetId: any, name: any) => {
      if (!state.data) return false
      const preset = ensureColorThemeDraft().presets.find((item) => item.id === String(presetId || ''))
      if (!preset) return false
      preset.name = String(name ?? '')
      emit()
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
      emit()
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
      saveMeta().catch(() => {})
      emit()
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
      saveMeta().catch(() => {})
      emit()
    },
    setBranchTreeDir: (dir: any) => {
      if (!state.data) return
      if (!state.data.settings || typeof state.data.settings !== 'object') state.data.settings = {} as any
      if (!(state.data.settings as any).branchTree || typeof (state.data.settings as any).branchTree !== 'object')
        (state.data.settings as any).branchTree = { dir: 'lr', view: 'right', followSelected: true, modalHotkey: '' }
      const v = String(dir || '').trim()
      const ok = v === 'lr' || v === 'tb' || v === 'bt' || v === 'rl'
      ;(state.data.settings as any).branchTree.dir = ok ? v : 'lr'
      saveMeta().catch(() => {})
      emit()
    },
    setBranchTreeView: (view: any) => {
      if (!state.data) return
      if (!state.data.settings || typeof state.data.settings !== 'object') state.data.settings = {} as any
      if (!(state.data.settings as any).branchTree || typeof (state.data.settings as any).branchTree !== 'object')
        (state.data.settings as any).branchTree = { dir: 'lr', view: 'right', followSelected: true, modalHotkey: '' }
      const v = String(view || '').trim()
      const ok = v === 'right' || v === 'float'
      ;(state.data.settings as any).branchTree.view = ok ? v : 'right'
      saveMeta().catch(() => {})
      emit()
    },
    setBranchTreeFollowSelected: (enabled: any) => {
      if (!state.data) return
      if (!state.data.settings || typeof state.data.settings !== 'object') state.data.settings = {} as any
      if (!(state.data.settings as any).branchTree || typeof (state.data.settings as any).branchTree !== 'object')
        (state.data.settings as any).branchTree = { dir: 'lr', view: 'right', followSelected: true, modalHotkey: '' }
      ;(state.data.settings as any).branchTree.followSelected = !!enabled
      saveMeta().catch(() => {})
      emit()
    },
    setBranchTreeModalHotkey: (hotkey: any) => {
      if (!state.data) return
      if (!state.data.settings || typeof state.data.settings !== 'object') state.data.settings = {} as any
      if (!(state.data.settings as any).branchTree || typeof (state.data.settings as any).branchTree !== 'object')
        (state.data.settings as any).branchTree = { dir: 'lr', view: 'right', followSelected: true, modalHotkey: '' }
      const v = String(hotkey || '').trim().slice(0, 80)
      ;(state.data.settings as any).branchTree.modalHotkey = v
      saveMeta().catch(() => {})
      emit()
    },
    setSettingsNavOrder: (order: any) => {
      if (!state.data || !Array.isArray(order)) return
      if (!state.data.settings || typeof state.data.settings !== 'object') state.data.settings = {} as any
      const seen = new Set<string>()
      const next: string[] = []
      for (const raw of order) {
        const value = String(raw || '').trim()
        if (!value || seen.has(value)) continue
        seen.add(value)
        next.push(value)
      }
      ;(state.data.settings as any).settingsNavOrder = next
      saveMeta().catch(() => {})
      emit()
    },
    toggleUserMessageCollapse: () => {
      if (!state.data) return
      state.data.settings.userMessageCollapseEnabled = !state.data.settings.userMessageCollapseEnabled
      saveMeta().catch(() => {})
      emit()
    },
    setUserMessageCollapseLines: (lines: any, commit: any) => {
      if (!state.data) return
      state.data.settings.userMessageCollapseLines = clamp(Math.round(Number(lines || 8)), 1, 50)
      if (commit) saveMeta().catch(() => {})
      emit()
    },
    setReasoningDisplayMode: (mode: any) => {
      if (!state.data) return
      state.data.settings.reasoningDisplayMode = normalizeReasoningDisplayMode(mode)
      saveMeta().catch(() => {})
      emit()
    },
    setReasoningRenderEnabled: (enabled: any) => {
      if (!state.data) return
      state.data.settings.reasoningRenderEnabled = normalizeReasoningRenderEnabled(enabled)
      saveMeta().catch(() => {})
      emit()
    },
  }
}
