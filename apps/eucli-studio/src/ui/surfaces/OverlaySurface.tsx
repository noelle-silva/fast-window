import * as React from 'react'
import { useRenderProbe } from '../../diagnostics/renderProbe'
import { ChatContextMenus } from '../dialogs/ChatContextMenus'
import { ChatPickerPopover } from '../dialogs/ChatPickerPopover'
import { ChatSessionDialogs } from '../dialogs/ChatSessionDialogs'
import { FavoriteFoldersDialogs } from '../dialogs/FavoriteFoldersDialogs'
import { MessageMenusDialogs } from '../dialogs/MessageMenusDialogs'
import { RolePickerPopover } from '../dialogs/RolePickerPopover'
import { RunningSessionsDialog } from '../dialogs/RunningSessionsDialog'
import { ComposerControlsPopovers } from '../composer/ComposerControlsPopovers'
import { ComposerImagePickerPopover } from '../composer/ComposerImagePickerPopover'

// 弹层表面：每个弹层组的 props 由 App 侧 useMemo 固定。
// 关闭的弹层因此不会随父级无关状态变化重渲染；打开状态变化只影响对应组。
export type OverlaySurfaceProps = {
  imagePicker: React.ComponentProps<typeof ComposerImagePickerPopover>
  messageMenus: React.ComponentProps<typeof MessageMenusDialogs>
  composerControls: React.ComponentProps<typeof ComposerControlsPopovers>
  rolePicker: React.ComponentProps<typeof RolePickerPopover>
  chatPicker: React.ComponentProps<typeof ChatPickerPopover>
  contextMenus: React.ComponentProps<typeof ChatContextMenus>
  favoriteDialogs: React.ComponentProps<typeof FavoriteFoldersDialogs>
  sessionDialogs: React.ComponentProps<typeof ChatSessionDialogs>
  runningSessions: React.ComponentProps<typeof RunningSessionsDialog>
}

export const OverlaySurface = React.memo(function OverlaySurface(props: OverlaySurfaceProps) {
  useRenderProbe('overlay')

  return (
    <>
      <ComposerImagePickerPopover {...props.imagePicker} />
      <MessageMenusDialogs {...props.messageMenus} />
      <ComposerControlsPopovers {...props.composerControls} />
      <RolePickerPopover {...props.rolePicker} />
      <ChatPickerPopover {...props.chatPicker} />
      <ChatContextMenus {...props.contextMenus} />
      <FavoriteFoldersDialogs {...props.favoriteDialogs} />
      <ChatSessionDialogs {...props.sessionDialogs} />
      <RunningSessionsDialog {...props.runningSessions} />
    </>
  )
})
