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
 * - 使用 MUI Dialog fullScreen，点关闭按钮或按 Esc 均可退出。
 * - iframe 允许内部滚动（不注入 autoHeight 探针），高度 100%。
 * - sandbox 保持 allow-scripts，与 AutoHeightHtmlIframe 保持一致。
 *
 * Esc 说明：
 *   点击 iframe 内部后焦点会转移到 iframe contentWindow，导致父页面
 *   收不到 keydown，MUI Dialog 的 Esc 原生行为失效。
 *   解法：当 open 时，监听 window blur（焦点离开父页面，多半是进了 iframe），
 *   立即把焦点收回到外层容器，这样 Esc 始终可以被父页面捕获。
 */
export function HtmlFaceFullscreenDialog({ open, html, onClose }: Props) {
  const srcDoc = React.useMemo(() => injectFullscreenStyle(html), [html])
  const containerRef = React.useRef<HTMLDivElement | null>(null)

  // 焦点守卫：窗口失去焦点（通常是进了 iframe）时把焦点拉回容器
  React.useEffect(() => {
    if (!open) return

    const refocusContainer = () => {
      // 用 rAF 延一帧，确保浏览器完成焦点转移后再抢回来
      requestAnimationFrame(() => {
        containerRef.current?.focus({ preventScroll: true })
      })
    }

    window.addEventListener('blur', refocusContainer)
    return () => window.removeEventListener('blur', refocusContainer)
  }, [open])

  // 弹层打开时，主动把焦点给到容器，确保 Esc 首次即生效
  React.useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      containerRef.current?.focus({ preventScroll: true })
    })
  }, [open])

  // 容器自身的 keydown 兜底：无论 MUI 的 Esc 处理是否命中，这里都能关闭
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    },
    [onClose],
  )

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      PaperProps={{
        sx: {
          bgcolor: '#fff',
          boxShadow: 'none',
          // inset:0 铺满，避免 100vw/100vh 在有滚动条时溢出
          position: 'absolute',
          inset: 0,
          m: 0,
          overflow: 'hidden',
        },
      }}
    >
      {/* tabIndex={-1}：让容器可接收焦点，从而能捕获 keydown */}
      <Box
        ref={containerRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        sx={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          outline: 'none',
        }}
      >
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
// 内部工具：给全屏 iframe 注入可滚动的基础样式
// ---------------------------------------------------------------------------

function injectFullscreenStyle(src: string): string {
  const raw = String(src || '')
  const doc = new DOMParser().parseFromString(raw, 'text/html')

  const head = doc.head || doc.getElementsByTagName('head')[0] || doc.documentElement

  // 移除 AutoHeightHtmlIframe 可能遗留的探针标签
  const oldStyle = doc.getElementById('hc-auto-height-style')
  if (oldStyle?.parentNode) oldStyle.parentNode.removeChild(oldStyle)
  const oldScript = doc.getElementById('hc-auto-height-probe')
  if (oldScript?.parentNode) oldScript.parentNode.removeChild(oldScript)

  // 注入全屏模式样式：撑满视口，纵向可滚动，横向不溢出
  const styleEl = doc.createElement('style')
  styleEl.id = 'hc-fullscreen-style'
  styleEl.textContent = 'html,body{margin:0;width:100%;height:100%;overflow-x:hidden;overflow-y:auto;box-sizing:border-box;}'
  head.appendChild(styleEl)

  return `<!doctype html>\n${doc.documentElement.outerHTML}`
}
