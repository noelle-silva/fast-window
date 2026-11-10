import * as React from 'react'
import { Box, DialogContent } from '@mui/material'
import { DependableDialog } from '../components/DependableOverlay'
import { TaskTreePanel, type TaskTreeBrowseState } from '../settings/TaskTreePanel'
import type { TaskScope } from '../../domain/taskTree'

// 输入区的任务入口：模态窗里直接挂设置页那套面板。
// 角色任务与工作区任务是两个独立入口，各自开各自的窗，窗内不再有作用域切换。
// 面板用 key 绑作用域，换按钮 = 重新挂载，归属选择与层级路径不会串到另一段作用域。
// 浏览位置（各段停留的归属与层级）由调用方按会话保存，开关窗口不丢。
export function ComposerTaskTreeDialog(props: {
  controller: any
  scope: TaskScope | null
  onClose: () => void
  roles: any[]
  workspaces: any[]
  /** 角色任务优先选中的归属：当前会话的角色。 */
  activeRoleId: string
  /** 工作区任务优先选中的归属：当前会话的工作区（不在工作区时为空）。 */
  activeWorkspaceId: string
  browseState?: Partial<Record<TaskScope, TaskTreeBrowseState>>
  onBrowseStateChange?: (scope: TaskScope, state: Required<TaskTreeBrowseState>) => void
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
  } = props

  return (
    <DependableDialog
      open={!!scope}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      PaperProps={{ sx: { bgcolor: 'var(--studio-paper-muted)' } }}
    >
      <DialogContent sx={{ p: 1.5, height: 'min(76vh, 760px)', display: 'flex', minHeight: 0 }}>
        {scope ? (
          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <TaskTreePanel
              key={scope}
              controller={controller}
              roles={roles}
              workspaces={workspaces}
              initialScope={scope}
              lockedScope={scope}
              initialOwnerId={scope === 'role' ? activeRoleId : activeWorkspaceId}
              preferredOwnerIds={{ role: activeRoleId, workspace: activeWorkspaceId }}
              browseState={browseState}
              onBrowseStateChange={onBrowseStateChange}
            />
          </Box>
        ) : null}
      </DialogContent>
    </DependableDialog>
  )
}
