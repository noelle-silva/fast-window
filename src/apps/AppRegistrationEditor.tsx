import type { ReactNode } from 'react'
import {
  Box, Button, FormControlLabel, Stack, Switch, TextField,
  ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import type { AppDisplayMode, AppHotkeyLaunchBehavior, AppKind, RegisteredAppShortcut } from './types'
import type { AppServiceInfo } from './appServiceInfo'
import type { IconImageSource } from '../iconImageInput'
import AppHostShortcutEditor from './AppHostShortcutEditor'
import AppIconEditor from './AppIconEditor'
import AppServiceInfoPanel from './AppServiceInfoPanel'
import { hostButtonSx, hostSurfaceSx, hostTextFieldSx, hostToggleGroupSx } from '../components/hostUiStyles'
import { useHostAppearance } from '../components/hostAppearance'

export type AppRegistrationDraft = {
  name: string
  path: string
  icon: string
  hotkey: string
  hotkeyLaunchBehavior: AppHotkeyLaunchBehavior
  displayMode: AppDisplayMode
  autoStart: boolean
  hostShortcuts: RegisteredAppShortcut[]
  hostShortcutsEdited: boolean
  hostShortcutCandidates: RegisteredAppShortcut[] | null
  appKind: AppKind | null
}

export function emptyAppRegistrationDraft(): AppRegistrationDraft {
  return {
    name: '',
    path: '',
    icon: '',
    hotkey: '',
    hotkeyLaunchBehavior: 'launch',
    displayMode: 'default',
    autoStart: false,
    hostShortcuts: [],
    hostShortcutsEdited: false,
    hostShortcutCandidates: null,
    appKind: null,
  }
}

type AppRegistrationEditorProps = {
  draft: AppRegistrationDraft
  saving: boolean
  pickingPath: boolean
  iconChanging: boolean
  hotkeyRecording: boolean
  recordingHostShortcutHotkeyId: string | null
  changingHostShortcutIconId: string | null
  readingHostShortcuts: boolean
  serviceInfo: AppServiceInfo | null
  serviceInfoLoading: boolean
  serviceInfoError: string | null
  onDraftChange: (patch: Partial<AppRegistrationDraft>) => void
  onPickPath: () => void
  onIconChange: (source: IconImageSource) => void
  onIconReset: () => void
  onStartHotkeyRecording: () => void
  onCancelHotkeyRecording: () => void
  onStartHostShortcutHotkeyRecording: (shortcutId: string) => void
  onHostShortcutIconChange: (shortcutId: string, source: IconImageSource) => void
  onHostShortcutIconReset: (shortcutId: string) => void
  onHostShortcutHotkeyClear: (shortcutId: string) => void
  onReadHostShortcuts: () => void
  onServiceInfoSaved: () => void
}

function EditorSection({ title, description, children }: {
  title: string
  description?: string
  children: ReactNode
}) {
  const hostAppearance = useHostAppearance()
  return (
    <Box
      sx={theme => ({
        ...hostSurfaceSx(hostAppearance.surfaceMode, { tone: 'item' })(theme),
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
      })}
    >
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>{title}</Typography>
        {description ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{description}</Typography>
        ) : null}
      </Box>
      {children}
    </Box>
  )
}

export default function AppRegistrationEditor(props: AppRegistrationEditorProps) {
  const {
    draft,
    saving,
    pickingPath,
    iconChanging,
    hotkeyRecording,
    recordingHostShortcutHotkeyId,
    changingHostShortcutIconId,
    readingHostShortcuts,
    serviceInfo,
    serviceInfoLoading,
    serviceInfoError,
    onDraftChange,
    onPickPath,
    onIconChange,
    onIconReset,
    onStartHotkeyRecording,
    onCancelHotkeyRecording,
    onStartHostShortcutHotkeyRecording,
    onHostShortcutIconChange,
    onHostShortcutIconReset,
    onHostShortcutHotkeyClear,
    onReadHostShortcuts,
    onServiceInfoSaved,
  } = props

  const showServiceInfo = draft.appKind === 'service-app'

  const autoStartField = (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>FW 启动时自启</Typography>
      <FormControlLabel
        sx={{ m: 0 }}
        control={
          <Switch
            size="small"
            checked={draft.autoStart}
            disabled={saving}
            onChange={e => onDraftChange({ autoStart: e.target.checked })}
            inputProps={{ 'aria-label': 'FW 启动时自启' }}
          />
        }
        label={draft.autoStart ? '已开启' : '已关闭'}
      />
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
        开启后，Fast Window 启动时会自动启动这个应用；关闭后仍可手动启动或通过快捷键唤醒。
      </Typography>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <EditorSection title="应用信息" description="名称用于主页与列表展示，路径指向要启动的可执行文件。">
        <TextField
          label="名称"
          value={draft.name}
          onChange={e => onDraftChange({ name: e.target.value })}
          size="small"
          fullWidth
          sx={hostTextFieldSx}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TextField
            label="可执行文件路径"
            value={draft.path}
            onChange={e => onDraftChange({ path: e.target.value })}
            size="small"
            fullWidth
            placeholder="C:\Apps\my-app\app.exe"
            sx={hostTextFieldSx}
          />
          <Button
            variant="text"
            onClick={onPickPath}
            disabled={pickingPath || saving}
            sx={{ ...hostButtonSx, flexShrink: 0 }}
          >
            {pickingPath ? '选择中…' : '选择文件'}
          </Button>
        </Box>
      </EditorSection>

      <AppIconEditor
        name={draft.name}
        icon={draft.icon}
        saving={saving}
        changing={iconChanging}
        canReset={!!draft.path.trim()}
        onChange={onIconChange}
        onResetDefault={onIconReset}
      />

      {showServiceInfo ? (
        <>
          <EditorSection title="启动设置">
            {autoStartField}
          </EditorSection>
          <EditorSection title="服务信息">
            <AppServiceInfoPanel
              info={serviceInfo}
              loading={serviceInfoLoading}
              error={serviceInfoError}
              exePath={draft.path.trim()}
              onSaved={onServiceInfoSaved}
            />
          </EditorSection>
        </>
      ) : (
        <>
          <EditorSection title="快捷键">
            <TextField
              label="快捷键（可选）"
              value={draft.hotkey}
              size="small"
              fullWidth
              placeholder="点击录制然后按键"
              InputProps={{ readOnly: true }}
              helperText={hotkeyRecording ? '录制中…按 ESC 取消，按下组合键即可保存到输入框里。' : '点击开始录制，然后按下组合键。'}
              sx={hostTextFieldSx}
            />
            <Stack direction="row" spacing={1}>
              <Button
                variant={hotkeyRecording ? 'contained' : 'text'}
                sx={hostButtonSx}
                color={hotkeyRecording ? 'warning' : 'primary'}
                onClick={hotkeyRecording ? onCancelHotkeyRecording : onStartHotkeyRecording}
              >
                {hotkeyRecording ? '录制中…' : '开始录制'}
              </Button>
              <Button variant="text" sx={hostButtonSx} onClick={() => onDraftChange({ hotkey: '' })}>
                清空快捷键
              </Button>
            </Stack>

            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>快捷键启动方式</Typography>
              <ToggleButtonGroup
                value={draft.hotkeyLaunchBehavior}
                exclusive
                onChange={(_, v) => v && onDraftChange({ hotkeyLaunchBehavior: v })}
                size="small"
                disabled={!draft.hotkey.trim()}
                aria-label="快捷键启动方式"
                sx={hostToggleGroupSx}
              >
                <ToggleButton value="launch">可启动未运行应用</ToggleButton>
                <ToggleButton value="runningOnly">仅控制已运行应用</ToggleButton>
              </ToggleButtonGroup>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
                选择“仅控制已运行应用”后，应用未运行时按下快捷键不会唤醒或启动它。
              </Typography>
            </Box>
          </EditorSection>

          <EditorSection title="启动与显示">
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>显示模式</Typography>
              <ToggleButtonGroup
                value={draft.displayMode}
                exclusive
                onChange={(_, v) => v && onDraftChange({ displayMode: v })}
                size="small"
                sx={hostToggleGroupSx}
              >
                <ToggleButton value="default">默认</ToggleButton>
                <ToggleButton value="window">窗口</ToggleButton>
                <ToggleButton value="top">置顶</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            {autoStartField}
          </EditorSection>

          <EditorSection title="宿主快捷命令" description="宿主快捷命令会出现在主页搜索列表里，用于快速打开应用内部页面或动作。这里不展示 App 能力 API。">
            <AppHostShortcutEditor
              shortcuts={draft.hostShortcuts}
              candidateShortcuts={draft.hostShortcutCandidates}
              appIcon={draft.icon}
              appName={draft.name}
              disabled={saving}
              changingShortcutIconId={changingHostShortcutIconId}
              readingHostShortcuts={readingHostShortcuts}
              canReadHostShortcuts={!!draft.path.trim()}
              onReadHostShortcuts={onReadHostShortcuts}
              recordingShortcutId={recordingHostShortcutHotkeyId}
              onChangeIcon={onHostShortcutIconChange}
              onResetIcon={onHostShortcutIconReset}
              onStartHotkeyRecording={onStartHostShortcutHotkeyRecording}
              onClearHotkey={onHostShortcutHotkeyClear}
              onChange={nextShortcuts => onDraftChange({ hostShortcuts: nextShortcuts, hostShortcutsEdited: true })}
            />
          </EditorSection>
        </>
      )}
    </Box>
  )
}
