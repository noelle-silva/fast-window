// 弹层过渡的统一事实源：主题动画时长与「关闭后必然卸载」等待时长同源派生。
//
// 背景：MUI 弹层（Popover / Menu / Dialog）的退场完成依赖过渡状态机的完成回调；
// 该回调在切会话等高频状态更新下会悬空（回调已创建却无人执行），
// 导致 Modal 容器永久残留并拦截全屏鼠标交互。关闭后的卸载保障必须等到
// 退场动画播完，因此卸载等待时长由退场时长派生，避免两处各自漂移。
export const OVERLAY_TRANSITION_DURATION = { enter: 225, exit: 195 } as const

// 退场动画后有 65ms 余量，覆盖最后一帧绘制与浏览器计时抖动。
export const OVERLAY_UNMOUNT_DELAY_MS = OVERLAY_TRANSITION_DURATION.exit + 65
