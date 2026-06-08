import * as React from 'react'
import { Box, Button, Typography } from '@mui/material'
import { softButtonSx } from './pluginUiStyles'

type ErrorBoundaryState = {
  error: Error | null
  componentStack: string
  capturedAt: string
}

function errorTitle(error: Error | null): string {
  return String(error?.name || 'Error').trim() || 'Error'
}

function errorMessage(error: Error | null): string {
  return String(error?.message || '未知错误').trim() || '未知错误'
}

function buildDiagnosticText(error: Error | null, componentStack: string, capturedAt: string): string {
  const sections = [
    `时间: ${capturedAt || '未知'}`,
    `错误类型: ${errorTitle(error)}`,
    `错误信息: ${errorMessage(error)}`,
  ]
  const stack = String(error?.stack || '').trim()
  if (stack) sections.push(`错误堆栈:\n${stack}`)
  const reactStack = String(componentStack || '').trim()
  if (reactStack) sections.push(`界面组件路径:\n${reactStack}`)
  return sections.join('\n\n')
}

function CrashDiagnosticDetails(props: { error: Error | null; componentStack: string; capturedAt: string }): React.ReactNode {
  const diagnosticText = buildDiagnosticText(props.error, props.componentStack, props.capturedAt)
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 900, color: 'rgba(0,0,0,.72)' }}>诊断详情</Typography>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1.25,
          borderRadius: 2.5,
          bgcolor: 'rgba(0,0,0,.045)',
          color: 'rgba(0,0,0,.76)',
          fontSize: 11,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          overflow: 'auto',
          maxHeight: 'min(52vh, 460px)',
          userSelect: 'text',
        }}
      >
        {diagnosticText}
      </Box>
    </Box>
  )
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: '', capturedAt: '' }

  static getDerivedStateFromError(error: Error) {
    return { error, capturedAt: new Date().toLocaleString() }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ componentStack: info.componentStack || '' })
    console.error('[hypercortex] ui crashed:', error)
    if (info.componentStack) console.error('[hypercortex] component stack:', info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#111' }}>HyperCortex 遇到了一点小意外</Typography>
        <Typography sx={{ fontSize: 12, lineHeight: 1.6, color: 'rgba(0,0,0,.62)' }}>
          {errorMessage(this.state.error)}
        </Typography>
        <CrashDiagnosticDetails error={this.state.error} componentStack={this.state.componentStack} capturedAt={this.state.capturedAt} />
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Button
            variant="contained"
            onClick={() => window.location.reload()}
            sx={{ textTransform: 'none' }}
          >
            刷新
          </Button>
          <Button
            variant="text"
            onClick={() => this.setState({ error: null, componentStack: '', capturedAt: '' })}
            sx={softButtonSx}
          >
            继续尝试
          </Button>
        </Box>
      </Box>
    )
  }
}

