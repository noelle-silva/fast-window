import { Box, Typography } from '@mui/material'
import { buildNotePlaceholderForCopy } from '../notePlaceholder'
import { AssetPoolPanel } from './AssetPoolPanel'
import { HomePage } from './HomePage'
import { IndexPage } from './IndexPage'
import { AllNotesPage } from './AllNotesPage'
import { NoteDetailSession } from './NoteDetailSession'
import { AssetDetailSession } from './AssetDetailSession'
import { SettingsPage } from './SettingsPage'
import { TrashPanel } from './TrashPanel'
import { RepoTrashPanel } from './repo-management/RepoTrashPanel'
import { noteTabKey } from '../tabKey'
import { assetTabId } from '../assetTypes'
import type { RepoWorkspaceOrchestration } from './useRepoWorkspaceOrchestration'

// 页面与模态体渲染：独立页面区与模态浮层复用同一批页面身体；
// 数据与回调一律由编排经显式入参传入，组件自身不持有状态。

export function RepoWorkspacePageContent(props: { orchestration: RepoWorkspaceOrchestration }) {
  const o = props.orchestration

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        overflow: o.page === 'note-detail' || o.page === 'asset-detail' ? 'hidden' : 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box
        sx={{
          minHeight: o.page === 'note-detail' || o.page === 'asset-detail' ? 0 : '100%',
          height: o.page === 'note-detail' || o.page === 'asset-detail' ? '100%' : 'auto',
          p: o.page === 'note-detail' || o.page === 'asset-detail' ? 0 : 2,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {o.page === 'home' ? (
          <HomePage
            stats={o.homeStats}
            recentNotes={o.homeRecentNotes}
            activeWorkspaceTitle={o.activeWorkspaceTitle}
            onCreateNote={o.handleCreateDraftNote}
            onOpenIndex={() => o.navigatePage('index')}
            onOpenAttachments={() => o.navigatePage('attachments')}
            onOpenAllNotes={() => o.navigatePage('all-notes')}
            onOpenSearch={() => o.setQuickSearchOpen(true)}
            onOpenNote={note => void o.handleOpenNote(note)}
          />
        ) : null}
        {o.page === 'attachments' ? <AssetPoolPanel gateway={o.gateway} scope="library" activeRepoId={o.repoId} onOpenAsset={o.handleOpenAssetTab} /> : null}
        {o.page === 'all-notes' ? (
          <AllNotesPage
            notes={o.allNotes}
            loading={o.noteIndexLoading}
            errorText={o.noteIndexLoadError}
            layout={o.allNotesLayout}
            noteCardInfoById={o.noteCardInfoById}
            onLayoutToggle={o.toggleAllNotesLayout}
            onOpenNote={note => void o.handleOpenNote(note)}
            onCopyRef={note => {
              void o.gateway.clipboard.writeText(buildNotePlaceholderForCopy(note.id, note.title))
              void o.gateway.host.toast('已复制引用占位符')
            }}
            onMore={o.openNoteCardMenu}
          />
        ) : null}
        <Box sx={{ display: o.page === 'note-detail' ? 'flex' : 'none', flex: 1, minHeight: 0, width: '100%', flexDirection: 'column' }}>
          {!o.openNoteTabs.length ? (
            <Box sx={{ p: 2 }}>
              <Typography color="text.secondary">没有打开的笔记。</Typography>
            </Box>
          ) : (
            o.openNoteTabs.map(tab => (
              <NoteDetailSession
                key={tab.id}
                ref={o.getNoteSessionRefCallback(tab.id)}
                gateway={o.gateway}
                scope="library"
                note={tab}
                visible={o.page === 'note-detail' && tab.id === o.activeNoteId}
                bodyScrollRef={o.page === 'note-detail' && tab.id === o.activeNoteId ? o.mainScrollElRef : undefined}
                noteIndexMap={o.noteIndexMap}
                allNotesById={o.allNotesById}
                refRelationsEpoch={o.refRelationsEpoch + o.externalNotesSignal}
                externalChangeSignal={o.externalNotesSignal}
                faceSwitchRequest={o.faceSwitchRequest}
                faceSwitchLatestSeq={o.faceSwitchLatestSeq}
                onFaceSwitchConsumed={o.handleFaceSwitchConsumed}
                consumeInitSnapshot={o.consumeInitSnapshot}
                onOpenNote={o.handleOpenNote}
                onEnsureNoteCardInfoLoaded={o.ensureNoteCardInfoLoaded}
                onDirtyChange={o.handleNoteDirtyChange}
                onSaved={o.handleNoteSessionSaved}
                trashEnabled={o.trashEnabled}
                onRequestDeleteNote={o.handleDeleteNote}
                favoritesDoc={o.favoritesDoc}
                onFavoriteSaved={o.handleFavoritesDocChange}
                onRevealNoteInFavorites={o.handleRevealNoteInFavorites}
                onPlayingChange={playing => o.setTabPlaying(noteTabKey(tab.id), playing)}
                facePluginGlobalSettings={o.facePluginSettings}
                globalFaceKindOrder={o.faceKindOrder}
              />
            ))
          )}
        </Box>
        <Box sx={{ display: o.page === 'asset-detail' ? 'flex' : 'none', flex: 1, minHeight: 0, width: '100%', flexDirection: 'column' }}>
          {!o.openAssetTabs.length ? (
            <Box sx={{ p: 2 }}>
              <Typography color="text.secondary">没有打开的附件。</Typography>
            </Box>
          ) : (
            o.openAssetTabs.map(asset => (
              <AssetDetailSession
                key={assetTabId(asset)}
                gateway={o.gateway}
                scope="library"
                asset={asset}
                visible={o.page === 'asset-detail' && assetTabId(asset) === o.activeTabKey}
                onAssetUpdated={o.handleAssetTabUpdated}
                onPlayingChange={playing => o.setTabPlaying(assetTabId(asset), playing)}
              />
            ))
          )}
        </Box>
        {o.page === 'index' && o.favoritesDoc ? (
          <IndexPage
            gateway={o.gateway}
            activeRepoId={o.repoId}
            doc={o.favoritesDoc}
            currentFolderId={o.currentFolderId}
            noteIndex={o.resolvedNoteIndex}
            assetIndex={o.assetPoolIndex?.assets}
            onNavigateFolder={o.handleNavigateFolder}
            onOpenNote={o.handleOpenNote}
            onOpenAsset={o.handleOpenAssetTab}
            onDocChange={o.handleFavoritesDocChange}
            onCreateNoteInIndex={o.handleCreateNoteInIndex}
            onUploadAssetsInIndex={o.handleUploadAssetsIntoIndex}
            onDeleteFolderEntity={o.handleDeleteFolderEntity}
            onDeleteNoteEntity={(note, refs) =>
              o.handleDeleteNote({ note, mode: o.trashEnabled ? 'trash' : 'permanent', refs })
                .then(() => true)
                .catch((e: any) => {
                  void o.gateway.host.toast(String(e?.message || e || '删除失败'))
                  return false
                })
            }
            onDeleteAssetEntity={(asset, refs) => o.requestDeleteAssetEntity(asset, { refs, mode: o.trashEnabled ? 'trash' : 'permanent' })}
            onUpdateNoteInfo={o.handleUpdateNoteInfo}
            onUpdateAssetInfo={o.handleUpdateAssetInfo}
          />
        ) : null}
        {o.page === 'trash' ? (
          <TrashPanel
            gateway={o.gateway}
            scope="library"
            refreshSignal={o.externalTrashSignal}
            onRestored={o.handleTrashRestored}
            onAssetRestored={asset => void o.handleTrashAssetRestored(asset)}
            onFavoritesRestored={doc => o.handleFavoritesDocChange(doc)}
            onPermanentlyDeleted={item => {
              if (item.kind === 'asset') {
                const key = item.ext ? `${item.assetId}.${item.ext}` : item.assetId || item.id
                o.setAssetPoolIndex(prev => {
                  if (!prev || typeof prev !== 'object') return prev
                  const assets = { ...((prev as any).assets || {}) }
                  delete assets[key]
                  return { ...(prev as any), assets }
                })
                o.closeTabKeysDirectRef.current([`asset:${key}`])
                return
              }
              if (item.kind === 'face' || item.kind === 'folder') return
              const nid = String(item.id || '').trim()
              if (!nid) return
              o.closeTabKeysDirectRef.current([noteTabKey(nid)])
              o.setNoteIndex(prev => {
                const current = prev || { version: 1, notes: {} }
                const nextNotes = { ...(current.notes || {}) }
                delete nextNotes[nid]
                return { ...current, notes: nextNotes }
              })
              o.bumpRefRelationsEpoch()
            }}
          />
        ) : null}
        {o.page === 'repo-trash' ? (
          <RepoTrashPanel gateway={o.shell.reposGateway} onRestored={repo => void o.handleRepoRestored(repo)} />
        ) : null}
        {o.page === 'settings' ? <RepoWorkspaceSettingsPage orchestration={o} /> : null}
      </Box>
    </Box>
  )
}

export function RepoWorkspaceModalBody(props: { orchestration: RepoWorkspaceOrchestration }) {
  const o = props.orchestration

  switch (o.openModalPage) {
    case 'home':
      return (
        <HomePage
          stats={o.homeStats}
          recentNotes={o.homeRecentNotes}
          activeWorkspaceTitle={o.activeWorkspaceTitle}
          onCreateNote={o.handleCreateDraftNote}
          onOpenIndex={() => o.navigatePage('index')}
          onOpenAttachments={() => o.navigatePage('attachments')}
          onOpenAllNotes={() => o.navigatePage('all-notes')}
          onOpenSearch={() => o.setQuickSearchOpen(true)}
          onOpenNote={note => void o.handleOpenNote(note)}
        />
      )
    case 'index': {
      if (!o.favoritesDoc) return null
      return (
        <IndexPage
          gateway={o.gateway}
          activeRepoId={o.repoId}
          doc={o.favoritesDoc}
          currentFolderId={o.currentFolderId}
          noteIndex={o.resolvedNoteIndex}
          assetIndex={o.assetPoolIndex?.assets}
          onNavigateFolder={o.handleNavigateFolder}
          onOpenNote={o.handleOpenNote}
          onOpenAsset={asset => {
            o.setOpenModalPage(null)
            void o.handleOpenAssetTab(asset)
          }}
          onDocChange={o.handleFavoritesDocChange}
          onCreateNoteInIndex={o.handleCreateNoteInIndex}
          onUploadAssetsInIndex={o.handleUploadAssetsIntoIndex}
          onDeleteFolderEntity={o.handleDeleteFolderEntity}
          onDeleteNoteEntity={(note, refs) =>
            o.handleDeleteNote({ note, mode: o.trashEnabled ? 'trash' : 'permanent', refs })
              .then(() => true)
              .catch((e: any) => {
                void o.gateway.host.toast(String(e?.message || e || '删除失败'))
                return false
              })
          }
          onDeleteAssetEntity={(asset, refs) => o.requestDeleteAssetEntity(asset, { refs, mode: o.trashEnabled ? 'trash' : 'permanent' })}
          onUpdateNoteInfo={o.handleUpdateNoteInfo}
          onUpdateAssetInfo={o.handleUpdateAssetInfo}
        />
      )
    }
    case 'attachments':
      return (
        <AssetPoolPanel
          gateway={o.gateway}
          scope="library"
          activeRepoId={o.repoId}
          onOpenAsset={asset => {
            o.setOpenModalPage(null)
            void o.handleOpenAssetTab(asset)
          }}
        />
      )
    case 'all-notes':
      return (
        <AllNotesPage
          notes={o.allNotes}
          loading={o.noteIndexLoading}
          errorText={o.noteIndexLoadError}
          layout={o.allNotesLayout}
          noteCardInfoById={o.noteCardInfoById}
          onLayoutToggle={o.toggleAllNotesLayout}
          onOpenNote={o.handleOpenNote}
          onCopyRef={note => {
            void o.gateway.clipboard.writeText(buildNotePlaceholderForCopy(note.id, note.title))
            void o.gateway.host.toast('已复制引用占位符')
          }}
          onMore={o.openNoteCardMenu}
        />
      )
    case 'settings':
      return <RepoWorkspaceSettingsPage orchestration={o} />
    default:
      return null
  }
}

function RepoWorkspaceSettingsPage(props: { orchestration: RepoWorkspaceOrchestration }) {
  const o = props.orchestration

  return (
    <SettingsPage
      dataDirStatus={o.shell.dataDirStatus}
      onRefreshDataDirStatus={o.shell.refreshDataDirStatus}
      onPickDataDir={o.shell.pickDataDir}
      onImportLegacyData={o.shell.importLegacyData}
      shortcutHintsEnabled={o.shortcutHintsEnabled}
      onShortcutHintsEnabledChange={o.handleShortcutHintsEnabledChange}
      shortcutBindings={o.shortcutBindings}
      onShortcutBindingsChange={o.handleShortcutBindingsChange}
      onShortcutRecordingChange={o.handleShortcutRecordingChange}
      sidebarSortMode={o.sidebarSortMode}
      onSidebarSortModeChange={o.handleSidebarSortModeChange}
      trashEnabled={o.trashEnabled}
      trashAutoDeleteDays={o.trashAutoDeleteDays}
      onTrashEnabledChange={o.handleTrashEnabledChange}
      onTrashAutoDeleteDaysChange={o.handleTrashAutoDeleteDaysChange}
      onOpenTrash={o.handleOpenTrashPage}
      facePluginSettings={o.facePluginSettings}
      onFacePluginSettingChange={o.handleFacePluginSettingChange}
      colorPresetId={o.colorPresetId}
      onColorPresetChange={o.handleColorPresetChange}
      pageDisplayModes={o.pageDisplayModes}
      onPageDisplayModeChange={o.handlePageDisplayModeChange}
      faceKindOrder={o.faceKindOrder}
      onFaceKindOrderChange={o.handleFaceKindOrderChange}
      defaultFaceKinds={o.defaultFaceKinds}
      onDefaultFaceKindsChange={o.handleDefaultFaceKindsChange}
      repoCacheLimit={o.repoCacheLimit}
      onRepoCacheLimitChange={o.handleRepoCacheLimitChange}
      repos={o.shell.repos}
      activeRepoId={o.shell.activeRepoId}
      onRenameRepo={o.shell.onRenameRepo}
      onDeleteRepo={o.shell.onDeleteRepo}
      onOpenRepoTrash={o.handleOpenRepoTrashPage}
      access={o.shell.reposGateway.access}
      onCopyAccessKey={text => {
        void o.gateway.clipboard.writeText(text)
        void o.gateway.host.toast('已复制访问密钥')
      }}
    />
  )
}
