import * as React from 'react'
import { Alert, Snackbar } from '@mui/material'

export type ToastSeverity = 'success' | 'info' | 'warning' | 'error'

type ToastState = { key: number; message: string; severity: ToastSeverity }

export type ToastApi = {
  showToast(message: string, severity?: ToastSeverity): void
}

const ToastContext = React.createContext<ToastApi | null>(null)

export function ToastProvider(props: { children: React.ReactNode }) {
  const [toast, setToast] = React.useState<ToastState | null>(null)
  const showToast = React.useCallback((message: string, severity: ToastSeverity = 'info') => {
    setToast({ key: Date.now(), message, severity })
  }, [])
  const api = React.useMemo<ToastApi>(() => ({ showToast }), [showToast])
  return (
    <ToastContext.Provider value={api}>
      {props.children}
      <Snackbar
        key={toast?.key}
        open={Boolean(toast)}
        autoHideDuration={3600}
        onClose={(_, reason) => { if (reason !== 'clickaway') setToast(null) }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)} sx={{ borderRadius: 3, boxShadow: '0 18px 42px rgba(15, 23, 42, 0.22)' }}>{toast.message}</Alert> : undefined}
      </Snackbar>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const api = React.useContext(ToastContext)
  if (!api) throw new Error('useToast 必须在 ToastProvider 内使用')
  return api
}
