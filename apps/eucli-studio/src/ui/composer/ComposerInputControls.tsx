import * as React from 'react'
import { Box, Button } from '@mui/material'
import { ComposerTextArea } from './ComposerTextArea'
import { useComposerDraftValue } from './useComposerDraftValue'

// 聊天输入区：输入本体交给 ComposerTextArea（与提示词库右栏同一份），
// 这里只管草稿读写、工具条、发送与停止按钮。
export function ComposerInputControls(props: {
  controller: any
  draftKey: string
  draftRevision: number
  initialValue: string
  inputRef: React.MutableRefObject<HTMLTextAreaElement | HTMLInputElement | null>
  disabled: boolean
  hasDraftNonText: boolean
  activeTargetKind: 'role' | 'group' | 'workspace'
  activeGroup: any
  roles: any[]
  activeStopRunId: string
  formatModelRefText: (modelRef: any) => string
  minRows: number
  radius: number
  toolbarStart?: React.ReactNode
  onSend: () => void
  onStop: () => void
  onPaste: (e: React.ClipboardEvent) => void
}) {
  const {
    controller,
    draftKey,
    draftRevision,
    initialValue,
    disabled,
    hasDraftNonText,
    activeStopRunId,
    toolbarStart,
    onSend,
    onStop,
    ...areaProps
  } = props

  const [value, onChange] = useComposerDraftValue({ controller, draftKey, draftRevision, initialValue })
  const sendDisabled = disabled || (!String(value || '').trim() && !hasDraftNonText)

  return (
    <>
      <ComposerTextArea
        {...areaProps}
        value={value}
        onChange={onChange}
        onEnter={onSend}
        disabled={disabled}
        resetKey={draftKey}
      />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', px: 0.25 }}>
        <Box data-area="composer-toolbar" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', flex: 1, minWidth: 0, pl: 1 }}>
          {toolbarStart}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, ml: 'auto', pr: 1 }}>
          {activeStopRunId ? (
            <Button variant="contained" color="error" onClick={onStop} disabled={disabled} sx={{ borderRadius: 999 }}>
              停止
            </Button>
          ) : null}

          <Button variant="contained" color="primary" onClick={onSend} disabled={sendDisabled} sx={{ borderRadius: 999 }}>
            发送
          </Button>
        </Box>
      </Box>
    </>
  )
}
