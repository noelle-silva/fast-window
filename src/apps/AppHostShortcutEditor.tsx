import { useState } from 'react'
import { Avatar, Box, Button, Stack, Typography } from '@mui/material'
import type { RegisteredAppShortcut } from './types'
import { generateSafeId } from './ids'
import AppHostShortcutPicker from './AppHostShortcutPicker'
import AppHostShortcutEditDialog from './AppHostShortcutEditDialog'
import { resolveHostShortcutIcon, resolveHostShortcutIconImageUrl } from './hostShortcutIcon'
import { hostButtonSx } from '../components/hostUiStyles'
import { hostToast } from '../host/hostPrimitives'

interface AppHostShortcutEditorProps {
  shortcuts: RegisteredAppShortcut[]
  candidateShortcuts: RegisteredAppShortcut[] | null
  appIcon: string
  appName: string
  disabled?: boolean
  readingHostShortcuts?: boolean
  canReadHostShortcuts?: boolean
  onReadHostShortcuts: () => void
  onChange: (shortcuts: RegisteredAppShortcut[]) => void
}

const HOTKEY_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

function uniqueShortcutId(title: string, shortcuts: RegisteredAppShortcut[]) {
  const base = generateSafeId(title, 'shortcut')
  const used = new Set(shortcuts.map(shortcut => shortcut.id))
  if (!used.has(base)) return base

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`
    if (!used.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

export default function AppHostShortcutEditor({
  shortcuts,
  candidateShortcuts,
  appIcon,
  appName,
  disabled = false,
  readingHostShortcuts = false,
  canReadHostShortcuts = true,
  onReadHostShortcuts,
  onChange,
}: AppHostShortcutEditorProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const editingShortcut = editingId ? shortcuts.find(shortcut => shortcut.id === editingId) ?? null : null

  const toggleCandidateShortcut = (candidate: RegisteredAppShortcut) => {
    if (shortcuts.some(shortcut => shortcut.id === candidate.id)) {
      onChange(shortcuts.filter(shortcut => shortcut.id !== candidate.id))
      return
    }
    onChange([...shortcuts, { ...candidate }])
  }

  const commitShortcut = (next: RegisteredAppShortcut) => {
    if (!editingId) return
    const siblings = shortcuts.filter(shortcut => shortcut.id !== editingId)
    const safeId = uniqueShortcutId(next.id, siblings)
    onChange(shortcuts.map(shortcut => shortcut.id === editingId ? { ...next, id: safeId } : shortcut))
    if (safeId !== next.id) {
      void hostToast(`快捷命令 ID「${next.id}」已存在，已自动调整为「${safeId}」`)
    }
    setEditingId(null)
  }

  const removeShortcut = () => {
    if (!editingId) return
    onChange(shortcuts.filter(shortcut => shortcut.id !== editingId))
    setEditingId(null)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <AppHostShortcutPicker
          candidates={candidateShortcuts}
          registeredShortcuts={shortcuts}
          appIcon={appIcon}
          disabled={disabled || readingHostShortcuts}
          onToggle={toggleCandidateShortcut}
        />
        <Button
          variant="text"
          disabled={disabled || readingHostShortcuts || !canReadHostShortcuts}
          onClick={onReadHostShortcuts}
          sx={{ ...hostButtonSx, flexShrink: 0 }}
        >
          {readingHostShortcuts ? '读取中…' : '读取宿主快捷命令'}
        </Button>
      </Box>

      {shortcuts.length ? (
        <Stack spacing={1}>
          {shortcuts.map(shortcut => {
            const iconImageUrl = resolveHostShortcutIconImageUrl(shortcut, appIcon)
            const displayIcon = resolveHostShortcutIcon(shortcut, appIcon)

            return (
              <Box key={shortcut.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Avatar
                  variant="rounded"
                  src={iconImageUrl}
                  imgProps={{ alt: `${shortcut.title || appName || '宿主快捷命令'} 图标预览` }}
                  sx={{ width: 32, height: 32, fontSize: 15, bgcolor: 'action.hover', color: 'text.primary', flexShrink: 0 }}
                >
                  {iconImageUrl ? null : displayIcon}
                </Avatar>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                    {shortcut.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
                    {shortcut.id}
                  </Typography>
                </Box>
                {shortcut.hotkey ? (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ fontFamily: HOTKEY_FONT_FAMILY, flexShrink: 0 }}
                  >
                    {shortcut.hotkey}
                  </Typography>
                ) : (
                  <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
                    未绑定
                  </Typography>
                )}
                <Button
                  size="small"
                  variant="text"
                  sx={{ ...hostButtonSx, flexShrink: 0 }}
                  disabled={disabled}
                  onClick={() => setEditingId(shortcut.id)}
                >
                  编辑
                </Button>
              </Box>
            )
          })}
        </Stack>
      ) : (
        <Typography variant="caption" color="text.secondary">
          暂未登记宿主快捷命令。可以点击“读取宿主快捷命令”从 App 获取。
        </Typography>
      )}

      <AppHostShortcutEditDialog
        open={!!editingShortcut}
        shortcut={editingShortcut}
        appIcon={appIcon}
        appName={appName}
        onClose={() => setEditingId(null)}
        onCommit={commitShortcut}
        onRemove={removeShortcut}
      />
    </Box>
  )
}
