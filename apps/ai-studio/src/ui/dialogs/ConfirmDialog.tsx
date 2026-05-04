import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'

export function ConfirmDialog(props: { open: boolean; controller: any; draft: any; roles: any[]; groups: any[]; providers: any[] }) {
  const { open, controller, draft, roles, groups, providers } = props
  const rid = String(draft?.deleteRoleId || '')
  const gid = String((draft as any)?.deleteGroupId || '')
  const pid = String(draft?.deleteProviderId || '')
  const nextRenderSafetyPolicy = String((draft as any)?.renderSafetyPolicyTarget || '').trim() === 'unsafe' ? 'unsafe' : ''
  const role = rid ? roles.find((r) => String(r?.id || '') === rid) : null
  const group = gid ? groups.find((g) => String(g?.id || '') === gid) : null
  const provider = pid ? providers.find((p) => String(p?.id || '') === pid) : null

  const title = nextRenderSafetyPolicy
    ? '放宽渲染安全策略'
    : rid
      ? '删除角色'
      : gid
        ? '删除群组'
        : pid
          ? '删除供应商'
          : '确认'
  const name = rid ? String(role?.name || '') : gid ? String(group?.name || '') : pid ? String(provider?.name || '') : ''

  return (
    <Dialog open={open} onClose={() => controller.actions.closeModal()} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        {nextRenderSafetyPolicy ? (
          <>
            <Typography variant="body2">你将把 AI 回复渲染切换为“完全裸奔”。</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              这会停止额外施加当前这层 HTML、SVG、Mermaid 安全限制，尽量按原始内容参与渲染与执行。仅在你完全信任消息来源时使用。
            </Typography>
          </>
        ) : (
          <>
            <Typography variant="body2">确认删除{name ? `：${name}` : ''}？</Typography>
            {pid ? (
              <Typography variant="caption" color="text.secondary">
                注意：至少保留一个供应商。
              </Typography>
            ) : gid ? (
              <Typography variant="caption" color="text.secondary">
                注意：群组的群聊记录也会一并删除。
              </Typography>
            ) : null}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => controller.actions.closeModal()}>取消</Button>
        <Button color={nextRenderSafetyPolicy ? 'warning' : 'error'} variant="contained" onClick={() => controller.actions.confirmDelete()}>
          {nextRenderSafetyPolicy ? '我已知晓风险，仍然切换到完全裸奔' : '删除'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

