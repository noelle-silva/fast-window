import * as React from 'react'
import { Box, Button } from '@mui/material'
import { ComposerTextArea } from './ComposerTextArea'
import { useComposerDraftValue } from './useComposerDraftValue'
import {
  COMPOSER_ACTION_BUTTON_GAP,
  COMPOSER_ACTION_BUTTON_HEIGHT,
  COMPOSER_ACTION_BUTTON_WIDTH,
  COMPOSER_ACTION_COLUMN_HEIGHT,
} from './composerActionMetrics'

// 聊天输入区：输入本体交给 ComposerTextArea（与提示词库右栏同一份），
// 这里只管草稿读写、工具条、发送与停止按钮。

// 动作按钮的尺寸全部由度量常量决定：不跟字体与内边距漂，
// 动作列的高度才是个可以拿来当高度下限的确定值。
const composerActionButtonSx = {
  width: COMPOSER_ACTION_BUTTON_WIDTH,
  minWidth: COMPOSER_ACTION_BUTTON_WIDTH,
  height: COMPOSER_ACTION_BUTTON_HEIGHT,
  px: 0,
  flexShrink: 0,
  borderRadius: '999px',
}

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

  // 工具条的下限就是动作列的高度：停止是否在场都占同一块空间。
  const toolbarMinHeight = `${COMPOSER_ACTION_COLUMN_HEIGHT}px`
  const actionGap = `${COMPOSER_ACTION_BUTTON_GAP}px`

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

      {/* 底栏：左侧工具条与右侧动作列底部对齐，发送按钮因此贴着面板下沿。
          动作列把停止叠在发送上面；工具按钮满两行时，首行顶上沿、末行贴下沿，
          高度仍由下限兜着 —— 只锁下限，不设上限。 */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.75, flexWrap: 'wrap', px: 0.25 }}>
        <Box
          data-area="composer-toolbar"
          sx={{
            display: 'flex',
            alignItems: 'flex-end',
            alignContent: 'space-between',
            gap: 0.5,
            flexWrap: 'wrap',
            flex: 1,
            minWidth: 0,
            minHeight: toolbarMinHeight,
            pl: 1,
          }}
        >
          {toolbarStart}
        </Box>

        <Box
          data-area="composer-actions"
          sx={{ display: 'flex', flexDirection: 'column', gap: actionGap, pr: 1, flexShrink: 0 }}
        >
          {activeStopRunId ? (
            <Button variant="contained" color="error" onClick={onStop} disabled={disabled} sx={composerActionButtonSx}>
              停止
            </Button>
          ) : null}

          <Button variant="contained" color="primary" onClick={onSend} disabled={sendDisabled} sx={composerActionButtonSx}>
            发送
          </Button>
        </Box>
      </Box>
    </>
  )
}
