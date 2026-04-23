import * as React from 'react'
import { Box, Dialog, IconButton, Tooltip } from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'

type Props = {
  open: boolean
  html: string
  onClose: () => void
}

/**
 * HTML 面全屏预览弹层。
 *
 * - 使用 MUI Dialog fullScreen，天然支持按 Esc 关闭。
 * - iframe 允许内部滚动（不注入 autoHeight 探针），高度 100%。
 * - sandbox 保持 allow-scripts，与 AutoHeightHtmlIframe 保持一致。
 */
export function HtmlFaceFullscreenDialog({ open, html, onClose }: Props) {
  const srcDoc = React.useMemo(() => injectFullscreenStyle(html), [html])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      PaperProps={{
        sx: {
          bgcolor: '#fff',
          boxShadow: 'none',
          // 用 inset:0 铺满，避免 100vw/100vh 在有滚动条时溢出
          position: 'absolute',
          inset: 0,
          m: 0,
          overflow: 'hidden',
        },
      }}
    >
      <Box sx={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <iframe
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            border: 'none',
          }}
          title="HTML 面全屏预览"
        />

        <Tooltip title="关闭全屏（Esc）" placement="bottom-end">
          <IconButton
            aria-label="关闭全屏"
            onClick={onClose}
            sx={{
              position: 'absolute',
              top: 12,
              right: 12,
              bgcolor: 'rgba(0,0,0,.35)',
              color: 'rgba(255,255,255,.92)',
              border: '1px solid rgba(255,255,255,.18)',
              '&:hover': { bgcolor: 'rgba(0,0,0,.52)' },
            }}
          >
            <CloseRoundedIcon />
          </IconButton>
        </Tooltip>
      </Box>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// 内部工具：给全屏 iframe 注入可滚动的基础样式（覆盖 AutoHeight 的 overflow:hidden）
// ---------------------------------------------------------------------------

function injectFullscreenStyle(src: string): string {
  const raw = String(src || '')
  const doc = new DOMParser().parseFromString(raw, 'text/html')

  const head = doc.head || doc.getElementsByTagName('head')[0] || doc.documentElement

  // 移除 AutoHeightHtmlIframe 可能遗留的 overflow:hidden 样式标签
  const oldStyle = doc.getElementById('hc-auto-height-style')
  if (oldStyle?.parentNode) oldStyle.parentNode.removeChild(oldStyle)
  const oldScript = doc.getElementById('hc-auto-height-probe')
  if (oldScript?.parentNode) oldScript.parentNode.removeChild(oldScript)

  // 插入全屏模式下允许滚动的样式
  const styleEl = doc.createElement('style')
  styleEl.id = 'hc-fullscreen-style'
  // html/body 撑满 iframe 视口，body 内容自然滚动
  styleEl.textContent = 'html,body{margin:0;width:100%;height:100%;overflow-x:hidden;overflow-y:auto;box-sizing:border-box;}'
  head.appendChild(styleEl)

  return `<!doctype html>\n${doc.documentElement.outerHTML}`
}
