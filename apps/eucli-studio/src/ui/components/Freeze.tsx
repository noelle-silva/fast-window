import * as React from 'react'

// Freeze：frozen 为真时冻结子树更新。
//
// 机制：缓存最近一次「解冻态」渲染出的子元素；冻结期间父级重渲染产生的新子元素被丢弃，
// 直接复用缓存元素。由于元素引用不变，React 会跳过该子树的调和，父级的重渲染不再传导进来。
//
// 用途：常驻但隐藏的页面（聊天页 / 设置页）在不可见时冻结，既保留已挂载状态
// （滚动位置、内部草稿、展开项），又避免随全局刷新空跑重渲染。
// 子树自身的订阅式更新（如消息范围订阅）不受影响，仍可独立更新。
export function Freeze(props: { frozen: boolean; children: React.ReactNode }) {
  const cacheRef = React.useRef<React.ReactNode>(props.children)
  if (!props.frozen) cacheRef.current = props.children
  return <>{cacheRef.current}</>
}
