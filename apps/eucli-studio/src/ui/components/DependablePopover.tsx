import * as React from 'react'
import { Menu, Popover, type MenuProps, type PopoverProps } from '@mui/material'
import { OVERLAY_UNMOUNT_DELAY_MS } from '../overlayTransition'

// useDependableOverlayPresence 是弹层「关闭后必然卸下」的生命周期。
//
// 开启时立即在场；关闭时先让退场动画照常播放，到固定时长后无条件判定为
// 「可以卸载」，不再依赖底层过渡状态机的完成回调——该回调在高频状态更新下
// 可能悬空，导致 Modal 容器永久残留并拦截全屏鼠标交互。这里把「关闭后固定
// 时长内必须从页面消失」作为弹层关闭语义的确定性保障。
function useDependableOverlayPresence(open: boolean) {
  const [unmountReady, setUnmountReady] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setUnmountReady(false)
      return
    }
    const timer = window.setTimeout(() => setUnmountReady(true), OVERLAY_UNMOUNT_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [open])

  return open || !unmountReady
}

// DependablePopover / DependableMenu 是全应用弹层的统一入口：
// 行为与 MUI 原组件完全一致，仅额外保证「关闭后必然卸下」。
export function DependablePopover(props: PopoverProps) {
  const { open = false, ...rest } = props
  const present = useDependableOverlayPresence(!!open)
  if (!present) return null
  return <Popover open={open} {...rest} />
}

export function DependableMenu(props: MenuProps) {
  const { open = false, ...rest } = props
  const present = useDependableOverlayPresence(!!open)
  if (!present) return null
  return <Menu open={open} {...rest} />
}
