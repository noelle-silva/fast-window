import { Box } from '@mui/material'
import { useRepoWorkspaceOrchestration } from './useRepoWorkspaceOrchestration'
import { WorkspaceInitGate } from './useRepoStateBootstrap'
import { RepoWorkspaceToolbarHost } from './RepoWorkspaceToolbarHost'
import { RepoWorkspacePageContent, RepoWorkspaceModalBody } from './RepoWorkspaceContent'
import { SidebarRail } from './SidebarRail'
import { OpenTabsPanel } from './OpenTabsPanel'
import { FavoritesSidebarPanel } from './FavoritesSidebarPanel'
import { PageOverlayHost } from './PageOverlayHost'
import { WorkspaceVisibilityProvider } from './workspaceVisibility'
import { SidebarHoldPreviewOverlay } from './sidebar-preview/SidebarHoldPreviewOverlay'
import { encodeSidebarPreviewTarget } from './sidebar-preview/previewTarget'

export type RepoWorkspaceProps = {
  repoId: string
  visible: boolean
}

/**
 * 仓库现场：一个仓库一份、常驻不销毁的完整工作现场。
 * 切换仓库只改变可见性；现场内的页面位置、标签页、未保存编辑、滚动与播放大体自然留存。
 * 编排见 useRepoWorkspaceOrchestration，页面与模态体渲染见 RepoWorkspaceContent，
 * 工具栏接线见 RepoWorkspaceToolbarHost；此处只保留工作区装配。
 */
export function RepoWorkspace(props: RepoWorkspaceProps) {
  const { visible } = props
  const o = useRepoWorkspaceOrchestration(props)

  return (
    <Box
      aria-hidden={!visible}
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        minHeight: 0,
        display: 'flex',
        alignItems: 'stretch',
        // 现场边界：每个仓库现场的溢出只在本现场内消化，常驻的隐藏现场不得撑开全局布局。
        overflow: 'hidden',
        visibility: visible ? 'visible' : 'hidden',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      {!o.repoReady ? (
        <WorkspaceInitGate
          error={o.workspaceInitError}
          retrying={o.workspaceInitRetrying}
          onRetry={() => void o.runRepoInitialization()}
        />
      ) : (
        <WorkspaceVisibilityProvider visible={visible}>
          {visible ? (
            <RepoWorkspaceToolbarHost orchestration={o} />
          ) : null}

          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', alignItems: 'stretch', position: 'relative' }}>
            <SidebarRail
              side="left"
              layout={o.leftSidebarLayout}
              onResizeEnd={o.handleTabsSidebarResizeEnd}
              onMouseEnter={o.onSidebarMouseEnter}
              onMouseLeave={o.onSidebarMouseLeave}
              onMouseOver={o.leftPreviewHover.onMouseOver}
            >
              <OpenTabsPanel
                panelWidth={o.sidebarPanelWidth}
                tabsMode={o.tabsMode}
                sidebarSortMode={o.sidebarSortMode}
                tabsCollapsed={o.tabsCollapsed}
                sidebarItems={o.sidebarItems}
                openTabKeys={o.openTabKeys}
                activeTabKey={o.activeTabKey}
                tabSelectionVisible={
                  o.resolvedSelectionSource === 'tabs' &&
                  (o.visiblePage === 'note-detail' || o.visiblePage === 'asset-detail')
                }
                activeTabScrollSignal={o.activeTabScrollSignal}
                sidebarScrollTop={o.sidebarScrollTopsRef.current[o.activeWorkspaceId] ?? 0}
                sidebarScrollRestoreSignal={o.sidebarScrollRestoreSignal}
                onSidebarScrollTopChange={o.handleSidebarScrollTopChange}
                openNoteTabs={o.openNoteTabs}
                openAssetTabs={o.openAssetTabs}
                playingTabKeys={o.playingTabKeys}
                isNoteDirty={o.isNoteDirtyById}
                workspaces={o.workspaces.map(w => ({ id: w.id, title: w.title }))}
                activeWorkspaceId={o.activeWorkspaceId}
                tabGroups={o.tabGrouping.groups}
                tabGroupByTabKey={o.tabGrouping.byTabKey}
                onToggleTabsCollapsed={o.toggleTabsCollapsed}
                onToggleTabsMode={o.toggleTabsMode}
                onCreateDraftNote={o.handleCreateDraftNote}
                onCollapseAllGroups={o.handleCollapseAllGroups}
                onSwitchWorkspace={o.handleSwitchWorkspace}
                onCreateWorkspace={o.handleCreateWorkspace}
                onRenameWorkspace={o.handleRenameWorkspace}
                onDeleteWorkspace={o.handleDeleteWorkspace}
                onCreateGroup={o.handleCreateTabGroup}
                onOpenTab={tab => void o.handleOpenNote(tab)}
                onCloseTab={o.handleCloseTab}
                onOpenAssetTab={o.handleOpenAssetTab}
                onCloseAssetTab={o.handleCloseAssetTab}
                onAssignTabToGroup={o.handleAssignTabToGroup}
                onUnassignTabFromGroup={o.handleUnassignTabFromGroup}
                onToggleGroupCollapsed={o.handleToggleGroupCollapsed}
                onRenameGroup={o.handleRenameGroup}
                onSetGroupColor={o.handleSetGroupColor}
                onDeleteGroupOnly={o.handleDeleteGroupOnly}
                onDeleteGroupAndCloseTabs={o.handleDeleteGroupAndCloseTabs}
                onCommitSidebarItems={o.handleCommitSidebarItems}
                onMoveTabToUngroupedIndex={o.handleMoveTabToUngroupedIndex}
                onMoveTabToGroupIndex={o.handleMoveTabToGroupIndex}
                onMoveGroupToIndex={o.handleMoveGroupToIndex}
              />
            </SidebarRail>

            <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
              <RepoWorkspacePageContent orchestration={o} />

              {o.previewTarget ? (
                <SidebarHoldPreviewOverlay
                  key={encodeSidebarPreviewTarget(o.previewTarget)}
                  gateway={o.gateway}
                  scope="library"
                  target={o.previewTarget}
                  noteIndex={o.resolvedNoteIndex}
                  assetLookup={o.favoritesFolderView.lookup}
                  favoritesDoc={o.favoritesDoc}
                  noteIndexMap={o.noteIndexMap}
                  allNotesById={o.allNotesById}
                  facePluginGlobalSettings={o.facePluginSettings}
                  globalFaceKindOrder={o.faceKindOrder}
                  scrollRef={o.previewOverlayScrollRef}
                />
              ) : null}
            </Box>

            <SidebarRail
              side="right"
              layout={o.rightSidebarLayout}
              onResizeEnd={o.handleFavoritesSidebarResizeEnd}
              onMouseEnter={o.onFavoritesSidebarMouseEnter}
              onMouseLeave={o.onFavoritesSidebarMouseLeave}
              onMouseOver={o.rightPreviewHover.onMouseOver}
            >
              <FavoritesSidebarPanel
                panelWidth={o.rightSidebarLayout.panelWidth}
                mode={o.favoritesSidebarMode}
                collapsed={o.favoritesSidebarCollapsed}
                doc={o.favoritesDoc}
                nav={o.favoritesNav}
                folderView={o.favoritesFolderView}
                noteIndex={o.resolvedNoteIndex}
                activeTabKey={o.activeTabKey}
                tabSelectionVisible={
                  o.resolvedSelectionSource === 'favorites' &&
                  (o.visiblePage === 'note-detail' || o.visiblePage === 'asset-detail')
                }
                activeEntryScrollSignal={o.favoritesActiveScrollSignal}
                scrollTop={o.favoritesScrollTopsRef.current[o.favoritesNav.currentFolderId] ?? 0}
                scrollRestoreSignal={o.favoritesScrollRestoreSignal}
                onScrollTopChange={o.handleFavoritesScrollTopChange}
                onNavigate={o.handleFavoritesSidebarNavigate}
                onBack={o.handleFavoritesSidebarBack}
                onForward={o.handleFavoritesSidebarForward}
                onToggleCollapsed={o.toggleFavoritesSidebarCollapsed}
                onToggleMode={o.toggleFavoritesSidebarMode}
                onOpenNote={(note, openInTabs) => void o.handleOpenNote(note, undefined, openInTabs ? 'tabs' : 'favorites')}
                onOpenAsset={(asset, openInTabs) => o.handleOpenAssetTab(asset, openInTabs ? 'tabs' : 'favorites')}
                onCreateNote={() => o.handleCreateDraftNoteInFolder(o.favoritesNav.currentFolderId)}
                onCreateFolder={o.handleCreateFolderInFavorites}
                onCloseDraftNote={o.handleCloseTab}
                onEntryContextMenu={o.handleFavoritesSidebarContextMenu}
                onReorderRefs={o.handleFavoritesSidebarReorder}
              />
            </SidebarRail>
          </Box>

          {visible && o.openModalPage ? (
            <PageOverlayHost open onClose={o.closeModalOverlay}>
              <RepoWorkspaceModalBody orchestration={o} />
            </PageOverlayHost>
          ) : null}

          {o.favoritesEntityNode}

          {o.noteCardMenuNode}

          {o.noteCardDeleteDialog}

          {o.assetEntityDeleteDialog}

          {o.closeTabPromptDialog}
        </WorkspaceVisibilityProvider>
      )}
    </Box>
  )
}
