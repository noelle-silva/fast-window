import * as React from 'react'
import { useEvent } from '../hooks/useEvent'

// 输入区草稿的读写：本地值负责逐键显示，composer 修订号负责外部对账。
// 聊天输入区与提示词库模态窗右栏共用这一份，两边看到的永远是同一段文字。
export function useComposerDraftValue(options: {
  controller: any
  draftKey: string
  draftRevision: number
  initialValue: string
}) {
  const { controller, draftKey, draftRevision, initialValue } = options
  const [value, setValue] = React.useState(() => String(initialValue || ''))

  // 外部草稿变更以 composer 范围修订号为准，而不是比较 initialValue：
  // 用户键入只更新本地值与草稿存储、不广播，父级可能从未用新文本重渲染；
  // 此时清空草稿后 initialValue 仍是空串，只有修订号能证明「外部确实变了」。
  React.useEffect(() => {
    setValue(String(initialValue || ''))
  }, [draftKey, initialValue, draftRevision])

  // 逐键写入走 setComposerInput（不广播）：输入区已经即时显示，广播只会让别处每键重渲染。
  const onChange = useEvent((next: string) => {
    setValue(next)
    controller.actions.setComposerInput?.(next)
  })

  return [value, onChange] as const
}
