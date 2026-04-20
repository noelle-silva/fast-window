import * as React from 'react'
import { Box, Button, Typography } from '@mui/material'

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[hypercortex] ui crashed:', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#111' }}>HyperCortex 遇到了一点小意外</Typography>
        <Typography sx={{ fontSize: 12, lineHeight: 1.6, color: 'rgba(0,0,0,.62)' }}>
          {this.state.error.message || '未知错误'}（更多细节请看控制台）
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Button
            variant="contained"
            onClick={() => window.location.reload()}
            sx={{ textTransform: 'none' }}
          >
            刷新
          </Button>
          <Button
            variant="outlined"
            onClick={() => this.setState({ error: null })}
            sx={{ textTransform: 'none' }}
          >
            继续尝试
          </Button>
        </Box>
      </Box>
    )
  }
}

