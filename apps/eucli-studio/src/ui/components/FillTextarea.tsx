import * as React from 'react'
import { Box, TextField } from '@mui/material'
import { CustomScrollbarThumbs, useCustomScrollbar } from '../scroll/CustomScrollbar'
import { customScrollbarHiddenSx, customScrollbarRevealSx } from '../scroll/customScrollbars'

// 撑满父级高度的多行输入：外层给多少高度就吃多少，再多内容也只在框内滚。
// 两条硬约束：
// 1. MUI 的 TextareaAutosize 会往 textarea 内联写 height 与 overflow:hidden，必须用 !important 压回去；
// 2. 原生滚动条隐藏，改用项目自制滑块（与聊天输入框同一套 useCustomScrollbar）。
const fillTextareaSx = {
  flex: '1 1 auto',
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  '& .MuiOutlinedInput-root': {
    flex: '1 1 auto',
    minHeight: 0,
    alignItems: 'stretch',
  },
  '& .MuiInputBase-inputMultiline': {
    flex: '1 1 auto',
    minWidth: 0,
    minHeight: 0,
    height: 'auto !important',
    overflowY: 'auto !important',
    resize: 'none',
  },
  '& .MuiOutlinedInput-root textarea': customScrollbarHiddenSx,
} as const

/** 吃掉剩余高度、内部自滚的多行输入框。 */
export function FillTextarea(props: {
  label: string
  value: string
  placeholder?: string
  readOnly?: boolean
  onChange?: (next: string) => void
}) {
  const { label, value, placeholder, readOnly, onChange } = props
  const boxRef = React.useRef<HTMLDivElement | null>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)

  const { metrics, viewport, dragging, beginDrag, updateMetrics } = useCustomScrollbar({
    scrollRef: textareaRef,
    containerRef: boxRef,
    axis: 'y',
  })

  // 内容变长后 scrollHeight 变了、元素尺寸却没变，ResizeObserver 不会触发，这里主动重测。
  React.useEffect(() => {
    updateMetrics()
  }, [value, updateMetrics])

  return (
    <Box
      ref={boxRef}
      sx={{
        position: 'relative',
        flex: '1 1 0',
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        ...customScrollbarRevealSx,
      }}
    >
      <TextField
        label={label}
        value={value}
        placeholder={placeholder}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        inputRef={textareaRef}
        InputProps={readOnly ? { readOnly: true } : undefined}
        fullWidth
        multiline
        sx={fillTextareaSx}
      />
      <CustomScrollbarThumbs metrics={metrics} dragging={dragging} onBeginDrag={beginDrag} viewport={viewport} />
    </Box>
  )
}
