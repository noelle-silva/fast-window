import * as React from 'react'
import { Dialog, Menu, Popover, type DialogProps, type MenuProps, type PopoverProps, type SxProps, type Theme } from '@mui/material'
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

// 进入关闭后，弹层的模态容器（含遮罩）立即退出交互：指针事件穿透到下层，
// 不再拦截鼠标与滚轮；键盘与焦点监听由底层随 open=false 自行解除。
// 保障作用于容器根节点，遮罩与面板作为子节点继承，退场动画不受影响。
const CLOSING_INTERACTION_GUARD = { pointerEvents: 'none' } as const

function overlaySx(sx: SxProps<Theme> | undefined, open: boolean): SxProps<Theme> | undefined {
  if (open) return sx
  if (sx == null) return CLOSING_INTERACTION_GUARD
  return [...(Array.isArray(sx) ? sx : [sx]), CLOSING_INTERACTION_GUARD]
}

// DependablePopover / DependableMenu / DependableDialog 是全应用弹层的统一入口：
// 行为与 MUI 原组件完全一致，仅额外保证「关闭后必然卸下、关闭后不拦截交互」。
export function DependablePopover(props: PopoverProps) {
  const { open = false, sx, ...rest } = props
  const present = useDependableOverlayPresence(!!open)
  if (!present) return null
  return <Popover open={open} sx={overlaySx(sx, !!open)} {...rest} />
}

export function DependableMenu(props: MenuProps) {
  const { open = false, sx, ...rest } = props
  const present = useDependableOverlayPresence(!!open)
  if (!present) return null
  return <Menu open={open} sx={overlaySx(sx, !!open)} {...rest} />
}

export function DependableDialog(props: DialogProps) {
  const { open = false, sx, ...rest } = props
  const present = useDependableOverlayPresence(!!open)
  if (!present) return null
  return <Dialog open={open} sx={overlaySx(sx, !!open)} {...rest} />
}
