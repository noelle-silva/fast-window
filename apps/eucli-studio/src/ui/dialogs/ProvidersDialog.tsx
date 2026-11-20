import { Box, DialogContent, DialogTitle, IconButton } from '@mui/material'
import { DependableDialog } from '../components/DependableOverlay'
import CloseIcon from '@mui/icons-material/Close'
import StorageIcon from '@mui/icons-material/Storage'
import { ProvidersSettingsPanel } from '../settings/ProvidersSettingsPanel'

export function ProvidersDialog(props: {
  open: boolean
  loading?: boolean
  controller: any
  providers: any[]
  draft: any
  models: any
  // providerCapabilities 是业务端声明的协议与思考档位清单；
  // 不传会让下拉退化成「只显示已保存的值」，看不到其它可选档位。
  providerCapabilities?: { protocols: any[]; reasoningEfforts: any[] }
}) {
  const { open, loading, controller, providers, draft, models, providerCapabilities } = props

  return (
    <DependableDialog
      open={open}
      onClose={() => controller.actions.closeModal()}
      fullWidth
      maxWidth="lg"
      PaperProps={{ sx: { height: 'min(780px, 88vh)', bgcolor: 'var(--studio-paper-muted)', backgroundImage: 'none' } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
        <StorageIcon fontSize="small" />
        供应商
        <Box sx={{ flex: 1 }} />
        <IconButton onClick={() => controller.actions.closeModal()} size="small" aria-label="关闭供应商窗口">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ p: 1.25, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <ProvidersSettingsPanel controller={controller} loading={!!loading} providers={providers} draft={draft} models={models} providerCapabilities={providerCapabilities} />
        </Box>
      </DialogContent>
    </DependableDialog>
  )
}
