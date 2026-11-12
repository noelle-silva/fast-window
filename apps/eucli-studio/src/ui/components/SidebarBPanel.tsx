import * as React from 'react'
import type { SidebarSide } from '../../domain/sidebarLayout'
import { deskFlatRefs, resolveDeskEntries, type DeskEntry } from '../../domain/desks'
import { sessionRefScopes } from '../../domain/sessionRefScope'
import {
  getDeskDrafts,
  getDeskDraftsVersion,
  removeDeskDraft,
  subscribeDeskDrafts,
  type DeskDraft,
} from '../../domain/deskDrafts'
import { refreshScopes } from '../../domain/uiRefreshScope'
import { workspaceRoleTargetId } from '../../domain/workspaceRoleTarget'
import type { ChatSessionRunNotice } from '../chatSessionRunObservations'
import { deskEntryNoticeKey, resolveDeskNoticeDot, type DeskNoticeDotKind } from '../deskNotice'
import { useScopedUiVersion, useScopedUiVersions } from '../hooks/useScopedUiVersion'
import type { DeskSidebarTab } from '../../domain/sidebarNavigationMemory'
import type { SidebarTabsVariant } from '../../domain/sidebarTabs'
import { SidebarFrame } from './SidebarFrame'
import { SidebarTabsHeader, type SidebarTabItem } from './SidebarTabsHeader'
import { FavoriteFoldersBrowser, type FavoriteFoldersBrowserProps } from './favorites/FavoriteFoldersBrowser'
import { DeskChatList } from './sidebar-b/DeskChatList'
import { DeskToolbar } from './sidebar-b/DeskToolbar'
import {
  DeskGroupTagMenu,
  DeskGroupTagRemoveDialog,
  DeskGroupTagRenameDialog,
  type DeskGroupTagMenuState,
} from './sidebar-b/DeskGroupTagMenus'
import {
  createDeskGroupTag,
  getDeskGroupTagsState,
  getDeskGroupTagsVersion,
  removeDeskGroupTag,
  renameDeskGroupTag,
  setDeskGroupTagColor,
  setDeskRowOrder,
  subscribeDeskGroupTags,
  type DeskGroupTag,
} from '../../domain/deskGroupTags'

// 侧边栏 B：工作桌面 / 会话收藏夹。两段都是会话的去处——
// 桌面只管把眼下要用的会话摆在手边，收藏夹按收藏夹层级浏览。
// 外壳与 A 共用 SidebarFrame，顶部切换栏与 A 共用 SidebarTabsHeader。
// 返回上一层属于收藏夹分类自己的工具行，落在 FavoriteFoldersBrowser 里，不占侧边栏级顶部栏。
const DESK_TABS: readonly SidebarTabItem<DeskSidebarTab>[] = [
  { value: 'desk', label: '工作桌面' },
  { value: 'favorites', label: '会话收藏夹' },
]

// 内存草稿是模块级可变状态：订阅版本号，再按版本取快照。
function useDeskDrafts(): DeskDraft[] {
  const version = React.useSyncExternalStore(subscribeDeskDrafts, getDeskDraftsVersion, getDeskDraftsVersion)
  return React.useMemo(() => getDeskDrafts(), [version])
}

// 分组标签同样是内存态：订阅版本号，再按版本取快照。
function useDeskGroupTags() {
  const version = React.useSyncExternalStore(
    subscribeDeskGroupTags,
    getDeskGroupTagsVersion,
    getDeskGroupTagsVersion,
  )
  return React.useMemo(() => getDeskGroupTagsState(), [version])
}

export type SidebarBPanelProps = {
  side: SidebarSide
  width: number
  sidebarRef: React.Ref<HTMLElement>
  resizing: boolean
  onSplitterPointerDown: (e: React.PointerEvent) => void
  topbarOpacity: number
  topbarBlur: number
  tab: DeskSidebarTab
  onTabChange: (tab: DeskSidebarTab) => void
  tabsVariant: SidebarTabsVariant
  favoritesBrowser: FavoriteFoldersBrowserProps
  controller: any
  data: any
  activeChatId: string
  runningChatIds: ReadonlySet<string>
  /** 会话运行通知（键 ＝ targetKind:targetId:chatId）：桌面行尾的红 / 绿点看它。 */
  chatSessionRunNotices: Readonly<Record<string, ChatSessionRunNotice>>
  /** 正卡在「等待确认」的会话键：桌面行尾的黄点看它。 */
  waitingConfirmationKeys: ReadonlySet<string>
  hoverShowsRoleIcon: boolean
  onOpenDeskEntry: (entry: DeskEntry) => void
  onRemoveDeskEntry: (entry: DeskEntry) => void
  onDismissDeskNotice: (entry: DeskEntry) => void
  onDeskEntryContextMenu: (event: React.MouseEvent, entry: DeskEntry) => void
}

export function SidebarBPanel(props: SidebarBPanelProps) {
  const {
    side,
    width,
    sidebarRef,
    resizing,
    onSplitterPointerDown,
    topbarOpacity,
    topbarBlur,
    tab,
    onTabChange,
    tabsVariant,
    favoritesBrowser,
    controller,
    data,
    activeChatId,
    runningChatIds,
    chatSessionRunNotices,
    waitingConfirmationKeys,
    hoverShowsRoleIcon,
    onOpenDeskEntry,
    onRemoveDeskEntry,
    onDismissDeskNotice,
    onDeskEntryContextMenu,
  } = props

  // 面板自己订阅桌面数据域：后端 sessions/desks 变更（增删、清理）就让清单重算；
  // 再按每条引用所在会话列表订阅，改名与会话增删也能跟上。
  const desksVersion = useScopedUiVersion(controller, refreshScopes.entities('desks'))
  const desks = (data as any)?.desks
  const flatRefs = React.useMemo(() => deskFlatRefs(desks), [desks, desksVersion])
  const chatListScopes = React.useMemo(
    () =>
      flatRefs.map((ref: any) =>
        refreshScopes.chatList(
          ref.targetKind,
          ref.targetKind === 'workspace' ? workspaceRoleTargetId(ref.targetId, ref.roleId) : ref.targetId,
        ),
      ),
    [flatRefs],
  )
  const chatListVersion = useScopedUiVersions(controller, chatListScopes)
  const deskEntries = React.useMemo(
    () => resolveDeskEntries(data, desks),
    [data, desks, desksVersion, chatListVersion],
  )

  // 桌面是跨 target 的引用清单：会话标题这类事实不在引用里，得靠各 target 的会话索引。
  // 启动阶段已按桌面引用批量预热过一轮，首帧就是真标题；
  // 这里只负责运行期新增的条目——同一批 pending 引用一次批量拉回，不再逐个往返。
  // 去重 + 失败静默：一个 target 拉不到不影响桌面其余条目。
  const prefetchedDeskScopesRef = React.useRef(new Set<string>())
  const pendingDeskScopes = React.useMemo(
    () => sessionRefScopes(deskEntries.filter((entry) => entry.status === 'pending')),
    [deskEntries],
  )
  React.useEffect(() => {
    if (tab !== 'desk') return
    const scopes = pendingDeskScopes.filter(
      (scope) => !prefetchedDeskScopesRef.current.has(`${scope.kind}:${scope.targetId}`),
    )
    if (!scopes.length) return
    // 先记账再发请求：失败的 target 本代不再重试，避免每次渲染都打一遍后端。
    for (const scope of scopes) prefetchedDeskScopesRef.current.add(`${scope.kind}:${scope.targetId}`)
    void (async () => {
      try {
        await controller.actions?.hydrateSessionIndexScopes?.(scopes)
      } catch {
        // 预取失败保持占位：索引下一轮刷新时条目自会恢复真标题。
      }
    })()
  }, [controller, pendingDeskScopes, tab])
  const deskDrafts = useDeskDrafts()

  // 分组标签与其混排顺序都只在内存里：新建、改名、换色、拖拽都只改这一份，
  // 进程结束或刷新即消失，这是本轮的预期行为。
  const deskGroupState = useDeskGroupTags()
  const [groupMenu, setGroupMenu] = React.useState<DeskGroupTagMenuState>(null)
  const [renameTarget, setRenameTarget] = React.useState<DeskGroupTag | null>(null)
  const [removeTarget, setRemoveTarget] = React.useState<DeskGroupTag | null>(null)

  const openGroupMenu = React.useCallback((event: React.MouseEvent, group: DeskGroupTag) => {
    setGroupMenu({ mouseX: event.clientX, mouseY: event.clientY, group })
  }, [])

  // 通知点按桌面引用键落表：条目一旦挪位置 / 增删，跟着桌面清单重算。
  // 正在看的会话不画点——提醒的意义在于「不在眼前」，切走时运行通知那边也会销账。
  const noticeDotByKey = React.useMemo(() => {
    const out: Record<string, DeskNoticeDotKind> = {}
    for (const entry of deskEntries) {
      if (entry.chatId === activeChatId) continue
      const key = deskEntryNoticeKey(entry)
      if (!key) continue
      const dot = resolveDeskNoticeDot({
        notice: chatSessionRunNotices[key],
        waitingConfirmation: waitingConfirmationKeys.has(key),
      })
      if (dot) out[entry.key] = dot
    }
    return out
  }, [deskEntries, activeChatId, chatSessionRunNotices, waitingConfirmationKeys])

  return (
    <SidebarFrame
      sidebarId="b"
      ariaLabel="侧边栏 B"
      side={side}
      width={width}
      sidebarRef={sidebarRef}
      resizing={resizing}
      onSplitterPointerDown={onSplitterPointerDown}
      topbarOpacity={topbarOpacity}
      topbarBlur={topbarBlur}
      header={
        <SidebarTabsHeader
          ariaLabel="侧边栏 B 页签"
          tabs={DESK_TABS}
          value={tab}
          onChange={onTabChange}
          variant={tabsVariant}
        />
      }
    >
      {tab === 'desk' ? (
        <>
          <DeskToolbar onCreateGroup={createDeskGroupTag} />
          <DeskChatList
            entries={deskEntries}
            groupTags={deskGroupState.groups}
            rowOrder={deskGroupState.order}
            drafts={deskDrafts}
            activeChatId={activeChatId}
            runningChatIds={runningChatIds}
            noticeDotByKey={noticeDotByKey}
            hoverShowsRoleIcon={hoverShowsRoleIcon}
            onOpen={onOpenDeskEntry}
            onRemove={onRemoveDeskEntry}
            onDismissNotice={onDismissDeskNotice}
            onContextMenu={onDeskEntryContextMenu}
            onRemoveDraft={(draft) => removeDeskDraft(draft.pendingChatId)}
            onReorder={setDeskRowOrder}
            onGroupContextMenu={openGroupMenu}
          />

          <DeskGroupTagMenu
            state={groupMenu}
            onClose={() => setGroupMenu(null)}
            onRename={(group) => setRenameTarget(group)}
            onSetColor={(groupId, color) => setDeskGroupTagColor(groupId, color)}
            onRemove={(group) => removeDeskGroupTag(group.id)}
            onRemoveWithChats={(group) => setRemoveTarget(group)}
          />
          <DeskGroupTagRenameDialog
            open={!!renameTarget}
            group={renameTarget}
            onClose={() => setRenameTarget(null)}
            onSubmit={(groupId, name) => renameDeskGroupTag(groupId, name)}
          />
          <DeskGroupTagRemoveDialog
            group={removeTarget}
            onClose={() => setRemoveTarget(null)}
            onConfirm={(groupId) => removeDeskGroupTag(groupId)}
          />
        </>
      ) : (
        <FavoriteFoldersBrowser {...favoritesBrowser} />
      )}
    </SidebarFrame>
  )
}
