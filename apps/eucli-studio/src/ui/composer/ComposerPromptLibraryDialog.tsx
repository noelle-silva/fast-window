import * as React from 'react'
import { Box, DialogContent, DialogTitle } from '@mui/material'
import { DependableDialog } from '../components/DependableOverlay'
import { PromptLibrarySettingsPanel } from '../settings/PromptLibrarySettingsPanel'
import { promptScopeLibraryTitle, type PromptScope } from '../../domain/promptLibrary'

// 输入区的提示词库入口：模态窗里直接挂设置页那套面板，标题按作用域取「xx 提示词库」。
// 面板用 key 绑作用域，换按钮 = 重新挂载，归属选择与草稿不会串到另一段作用域。
export function ComposerPromptLibraryDialog(props: {
  controller: any
  scope: PromptScope | null
  onClose: () => void
  roles: any[]
  workspaces: any[]
  /** 角色库优先选中的归属：当前会话的角色。 */
  activeRoleId: string
}) {
  const { controller, scope, onClose, roles = [], workspaces = [], activeRoleId = '' } = props

  return (
    <DependableDialog
      open={!!scope}
      onClose={onClose}
      fullWidth
      // 面板宽度按内容定：260 侧边栏 + 编辑器 + 顶部一行（含 328 归属槽位），
      // md（900）刚好放得下；卡片会撑满这个宽度，不会在右侧留白。
      maxWidth="md"
      PaperProps={{ sx: { bgcolor: 'var(--studio-paper-muted)' } }}
    >
      <DialogTitle>{scope ? promptScopeLibraryTitle(scope) : ''}</DialogTitle>
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
              initialOwnerId={scope === 'role' ? activeRoleId : ''}
            />
          </Box>
        ) : null}
      </DialogContent>
    </DependableDialog>
  )
}
