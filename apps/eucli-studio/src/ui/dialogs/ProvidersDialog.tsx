import { Box, Dialog, DialogContent, DialogTitle, IconButton } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import StorageIcon from '@mui/icons-material/Storage'
import { ProvidersSettingsPanel } from '../settings/ProvidersSettingsPanel'

export function ProvidersDialog(props: { open: boolean; loading?: boolean; controller: any; providers: any[]; draft: any; models: any }) {
  const { open, loading, controller, providers, draft, models } = props

  return (
    <Dialog
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
          <ProvidersSettingsPanel controller={controller} loading={!!loading} providers={providers} draft={draft} models={models} />
        </Box>
      </DialogContent>
    </Dialog>
  )
}
