import { clamp, uid } from '../../core/utils'
import {
  COLOR_THEME_SETTING_KEY,
  listColorThemePresets,
  mergeImportedColorThemePresets,
  normalizeColorThemeSettings,
  parseColorThemePresetImport,
} from '../../domain/colorTheme'
import { CHAT_ATTACHMENT_KINDS, DEFAULT_ATTACH_SEND_LIMIT_CHARS, DEFAULT_ATTACH_MAX_FILE_MB, MAX_ATTACH_MAX_FILE_MB } from '../../domain/constants'
import type { AiChatShowToast } from '../../gateway/capabilities'

export function createAppearanceActions(deps: {
  state: any
  emit: () => void
  saveMeta: () => Promise<any>
  showToast?: AiChatShowToast
  currentRenderSafetyPolicy: () => string
}) {
  const { state, emit, saveMeta, showToast, currentRenderSafetyPolicy } = deps

  return {
    setSideTab: (tab: any) => {
      state.sideTab = tab === 'chats' ? 'chats' : 'roles'
      emit()
    },
    toggleTransparentChatBg: () => {
      if (!state.data) return
      state.data.settings.transparentChatBg = !state.data.settings.transparentChatBg
      saveMeta().catch(() => {})
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
    setColorThemePreset: (presetId: any) => {
      if (!state.data) return
      const id = String(presetId || '').trim()
      const settings = normalizeColorThemeSettings((state.data.settings as any)[COLOR_THEME_SETTING_KEY])
      const exists = listColorThemePresets(settings).some((preset) => preset.id === id)
      if (!exists) return showToast?.('配色预设不存在', { kind: 'error' })
      ;(state.data.settings as any)[COLOR_THEME_SETTING_KEY] = { ...settings, activePresetId: id }
      saveMeta().catch(() => {})
      emit()
      return true
    },
    importColorThemePresets: (jsonText: any) => {
      if (!state.data) return false
      try {
        const presets = parseColorThemePresetImport(String(jsonText || ''), () => uid('color_theme'))
        ;(state.data.settings as any)[COLOR_THEME_SETTING_KEY] = mergeImportedColorThemePresets(
          (state.data.settings as any)[COLOR_THEME_SETTING_KEY],
          presets,
        )
        saveMeta().catch(() => {})
        emit()
        showToast?.(`已导入 ${presets.length} 个配色预设`, { kind: 'success' })
        return true
      } catch (error: any) {
        showToast?.(String(error?.message || error || '导入配色失败'), { kind: 'error' })
        return false
      }
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
    setAttachmentsSendLimitChars: (chars: any, commit: any) => {
      if (!state.data) return
      if (!state.data.settings.attachments || typeof state.data.settings.attachments !== 'object') {
        state.data.settings.attachments = { sendLimitChars: DEFAULT_ATTACH_SEND_LIMIT_CHARS } as any
      }
      const at = state.data.settings.attachments as any
      at.sendLimitChars = clamp(Math.round(Number(chars || DEFAULT_ATTACH_SEND_LIMIT_CHARS)), 1000, 2_000_000)
      if (commit) saveMeta().catch(() => {})
      emit()
    },
    setAttachmentsMaxFileSizeMb: (kind: any, mb: any, commit: any) => {
      if (!state.data) return
      const k = String(kind || '').trim()
      if (!CHAT_ATTACHMENT_KINDS.has(k)) return
      if (!state.data.settings.attachments || typeof state.data.settings.attachments !== 'object') {
        state.data.settings.attachments = { sendLimitChars: DEFAULT_ATTACH_SEND_LIMIT_CHARS, maxFileSizeMbByKind: {} } as any
      }
      const at = state.data.settings.attachments as any
      if (!at.maxFileSizeMbByKind || typeof at.maxFileSizeMbByKind !== 'object') at.maxFileSizeMbByKind = {}
      const n = Number(mb)
      const next = !isFinite(n) ? DEFAULT_ATTACH_MAX_FILE_MB : clamp(Math.round(n), 0, MAX_ATTACH_MAX_FILE_MB)
      at.maxFileSizeMbByKind[k] = next
      if (commit) saveMeta().catch(() => {})
      emit()
    },
  }
}
