import * as React from 'react'
import { Box } from '@mui/material'
import { COMPOSER_REFRESH_SCOPE } from '../../domain/uiRefreshScope'
import { useScopedUiVersion } from '../hooks/useScopedUiVersion'
import { ComposerTextArea } from './ComposerTextArea'
import { useComposerDraftValue } from './useComposerDraftValue'

// 提示词库模态窗的最右一栏：直接编辑当前输入框的那段文字。
// 输入本体、粘贴、选中复制、框内滚动都用聊天输入区同一份 ComposerTextArea；
// 草稿读写走同一个 useComposerDraftValue。两边看到的就是同一段文字。
// 这里不发送：Enter 在右栏保持换行，浏览提示词时不会误把消息发出去。
const NO_ROLES: any[] = []
const NO_MODEL_TEXT = () => ''

export function ComposerDraftPane(props: {
  controller: any
  draftKey: string
  onPaste?: (e: React.ClipboardEvent) => void
  width?: number
}) {
  const { controller, draftKey, onPaste, width = 280 } = props
  const revision = useScopedUiVersion(controller, COMPOSER_REFRESH_SCOPE)
  const initialValue = String(controller.getComposerDraft()?.input || '')
  const [value, onChange] = useComposerDraftValue({
    controller,
    draftKey,
    draftRevision: revision,
    initialValue,
  })
  const inputRef = React.useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)

  return (
    <Box
      sx={{
        width,
        flexShrink: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 2,
        bgcolor: 'var(--studio-field)',
        p: 0.75,
      }}
    >
      <ComposerTextArea
        value={value}
        onChange={onChange}
        inputRef={inputRef}
        disabled={false}
        activeTargetKind="role"
        activeGroup={null}
        roles={NO_ROLES}
        formatModelRefText={NO_MODEL_TEXT}
        minRows={8}
        radius={8}
        placeholder=""
        onPaste={onPaste}
        resetKey={draftKey}
        fill
      />
    </Box>
  )
}
