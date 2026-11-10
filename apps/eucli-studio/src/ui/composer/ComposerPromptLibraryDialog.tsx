import * as React from 'react'
import { Box, DialogContent } from '@mui/material'
import { DependableDialog } from '../components/DependableOverlay'
import { PromptLibrarySettingsPanel, type PromptLibraryBrowseState } from '../settings/PromptLibrarySettingsPanel'
import type { PromptScope } from '../../domain/promptLibrary'
import { ComposerDraftPane } from './ComposerDraftPane'
import type { ComposerTextAreaInsertApi } from './ComposerTextArea'

// 输入区的提示词库入口：模态窗里直接挂设置页那套面板。
// 不设标题栏：面板顶部就是作用域切换，当前在看哪个库由它自己说明。
// 面板用 key 绑作用域，换按钮 = 重新挂载，归属选择与草稿不会串到另一段作用域。
// 浏览位置（各段停留的归属与收藏夹层级）由调用方按会话保存，开关窗口不丢。
// 面板最右侧额外挂一栏当前输入框：浏览提示词时顺手改要发出去的那段文字。
const DIALOG_MAX_WIDTH = 1080

export function ComposerPromptLibraryDialog(props: {
  controller: any
  scope: PromptScope | null
  onClose: () => void
  roles: any[]
  workspaces: any[]
  /** 角色库优先选中的归属：当前会话的角色。 */
  activeRoleId: string
  /** 工作区库优先选中的归属：当前会话的工作区（不在工作区时为空）。 */
  activeWorkspaceId: string
  browseState?: Partial<Record<PromptScope, PromptLibraryBrowseState>>
  onBrowseStateChange?: (scope: PromptScope, state: Required<PromptLibraryBrowseState>) => void
  /** 当前会话的草稿键：右栏与输入区认同一份草稿的前提。 */
  composerDraftKey?: string
  /** 输入区的粘贴处理：右栏粘贴图片时也走同一条通路。 */
  onPaste?: (e: React.ClipboardEvent) => void
  /** 行内「填入」：把提示词正文插到输入框当前光标处。 */
  onInsertPromptText?: (text: string) => void
}) {
  const {
    controller,
    scope,
    onClose,
    roles = [],
    workspaces = [],
    activeRoleId = '',
    activeWorkspaceId = '',
    browseState,
    onBrowseStateChange,
    composerDraftKey = '',
    onPaste,
    onInsertPromptText,
  } = props

  // 右栏优先：模态窗开着时它是唯一可见的输入框，填入与光标都落在那里。
  // 右栏还没挂起来时回落到调用方给的外部入口。
  const paneApiRef = React.useRef<ComposerTextAreaInsertApi | null>(null)
  const handlePaneReady = React.useCallback((api: ComposerTextAreaInsertApi | null) => {
    paneApiRef.current = api
  }, [])
  const insertPromptText = React.useCallback(
    (text: string) => {
      if (paneApiRef.current?.insertAtCaret(text)) return
      onInsertPromptText?.(text)
    },
    [onInsertPromptText],
  )

  return (
    <DependableDialog
      open={!!scope}
      onClose={onClose}
      fullWidth
      // 宽度按内容定：260 侧边栏 + 编辑器 + 280 输入框栏，再把既有排布收窄一些。
      // 1080 是在原来 md（900）上放宽五分之一，既有栏各自让出一段横向空间。
      maxWidth={false}
      PaperProps={{ sx: { bgcolor: 'var(--studio-paper-muted)', maxWidth: DIALOG_MAX_WIDTH } }}
    >
      <DialogContent sx={{ p: 1.5, height: 'min(76vh, 760px)', display: 'flex', minHeight: 0 }}>
        {scope ? (
          // 竖向 flex：面板在交叉轴上 stretch，宽度撑满对话框。
          // 横向 flex 会把面板当成 flex item、收缩到内容宽度，右侧留出一条空白。
          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <PromptLibrarySettingsPanel
              key={scope}
              controller={controller}
              roles={roles}
              workspaces={workspaces}
              initialScope={scope}
              initialOwnerId={scope === 'role' ? activeRoleId : scope === 'workspace' ? activeWorkspaceId : ''}
              preferredOwnerIds={{ role: activeRoleId, workspace: activeWorkspaceId }}
              browseState={browseState}
              onBrowseStateChange={onBrowseStateChange}
              sidePane={
                <ComposerDraftPane
                  controller={controller}
                  draftKey={composerDraftKey}
                  onPaste={onPaste}
                  onReady={handlePaneReady}
                />
              }
              onInsertPromptText={insertPromptText}
            />
          </Box>
        ) : null}
      </DialogContent>
    </DependableDialog>
  )
}
