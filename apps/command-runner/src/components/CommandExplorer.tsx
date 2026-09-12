import * as React from 'react'
import { Box, Breadcrumbs, Button, Typography } from '@mui/material'
import {
  collectionParentId,
  collectionSubtreeFolderIds,
  type CollectionNodes,
} from '../collectionsTree'
import type { AppSettings, CollectionNode, CommandItem, Repo, ShellInfo } from '../types'
import { CommandCard } from './CommandCard'
import { FolderCard } from './FolderCard'
import {
  SortableDropTarget,
  SortableItem,
  SortableRoot,
  SortableSection,
  resolveSortMovePosition,
  type SortableDropTargetRenderArgs,
} from './SortableDnd'

type CommandExplorerProps = {
  repo: Repo
  nodes: CollectionNodes
  commands: CommandItem[]
  settings: AppSettings | null
  shells: ShellInfo[]
  disabled?: boolean
  currentFolderId: string
  pathIds: string[]
  onNavigate: (folderId: string) => void
  runningCountFor: (commandId: string) => number
  onRun: (command: CommandItem) => void
  onEdit: (command: CommandItem) => void
  onDelete: (command: CommandItem) => void
  onMove: (nodeId: string, targetId: string, index: number) => void
  onRenameFolder: (folder: CollectionNode) => void
  onDeleteFolder: (folder: CollectionNode) => void
}

const ROOT_LABEL = '全部'

function countCommandsIn(folderId: string, nodes: CollectionNodes, commandById: Map<string, CommandItem>): number {
  let count = 0
  const stack = [folderId]
  while (stack.length > 0) {
    const current = stack.pop() as string
    const folder = nodes[current]
    if (!folder) continue
    for (const childId of folder.children) {
      if (nodes[childId]) stack.push(childId)
      else if (commandById.has(childId)) count += 1
    }
  }
  return count
}

export function CommandExplorer({
  repo,
  nodes,
  commands,
  settings,
  shells,
  disabled = false,
  currentFolderId,
  pathIds,
  onNavigate,
  runningCountFor,
  onRun,
  onEdit,
  onDelete,
  onMove,
  onRenameFolder,
  onDeleteFolder,
}: CommandExplorerProps) {
  const root = nodes[repo.id]
  const commandById = React.useMemo(() => new Map(commands.map(command => [command.id, command])), [commands])
  const folder = nodes[currentFolderId]
  const children = React.useMemo(() => folder?.children ?? [], [folder])

  // 普通拖拽：当前页内同层排序。
  const handleMove = React.useCallback((activeId: string, overId: string) => {
    if (!children.includes(activeId) || !children.includes(overId)) return
    const position = resolveSortMovePosition(children, activeId, overId)
    if (!position) return
    const movingIndex = children.indexOf(activeId)
    let toIndex = children.indexOf(overId)
    if (position === 'after') toIndex += 1
    if (movingIndex < toIndex) toIndex -= 1
    if (toIndex === movingIndex) return
    onMove(activeId, currentFolderId, toIndex)
  }, [children, currentFolderId, onMove])

  // Ctrl 拖拽：移动到目标收藏夹（页面内卡片或路径栏节点）。
  const canDrop = React.useCallback((activeId: string, targetId: string) => {
    const target = nodes[targetId]
    if (!target) return false
    const activeParent = collectionParentId(nodes, activeId)
    if (!activeParent || activeParent === targetId) return false
    const command = commandById.get(activeId)
    if (command) return command.repoId === target.repoId
    const activeFolder = nodes[activeId]
    if (!activeFolder || activeFolder.repoId !== target.repoId) return false
    return !collectionSubtreeFolderIds(nodes, activeId).has(targetId)
  }, [nodes, commandById])

  const handleDrop = React.useCallback((activeId: string, targetId: string) => {
    if (!canDrop(activeId, targetId)) return
    onMove(activeId, targetId, -1)
  }, [canDrop, onMove])

  const drop = React.useMemo(() => ({ canDrop, onDrop: handleDrop }), [canDrop, handleDrop])

  if (!root) return null

  return (
    <SortableRoot onMove={handleMove} drop={drop}>
      <Box className="cr-command-area">
        <Box className="cr-path-bar">
          <Breadcrumbs
            separator={<Typography component="span" sx={{ color: 'text.disabled', fontSize: 12 }}>/</Typography>}
            sx={{ minWidth: 0 }}
          >
            {pathIds.map(id => (
              <PathCrumb
                key={id}
                folderId={id}
                label={id === repo.id ? ROOT_LABEL : (nodes[id]?.name || '未命名收藏夹')}
                active={id === currentFolderId}
                onNavigate={() => onNavigate(id)}
              />
            ))}
          </Breadcrumbs>
        </Box>
        <Box className="cr-explorer-list">
          <SortableSection items={children}>
            {children.map(id => {
              const childFolder = nodes[id]
              if (childFolder) {
                return (
                  <SortableItem key={id} id={id} disabled={disabled}>
                    {(sortable) => (
                      <FolderCard
                        folder={childFolder}
                        commandCount={countCommandsIn(childFolder.id, nodes, commandById)}
                        sortable={sortable}
                        onOpen={() => onNavigate(childFolder.id)}
                        onRename={() => onRenameFolder(childFolder)}
                        onDelete={() => onDeleteFolder(childFolder)}
                      />
                    )}
                  </SortableItem>
                )
              }
              const command = commandById.get(id)
              if (!command) return null
              return (
                <SortableItem key={id} id={id} disabled={disabled}>
                  {(sortable) => (
                    <CommandCard
                      command={command}
                      repo={repo}
                      settings={settings}
                      shells={shells}
                      runningCount={runningCountFor(command.id)}
                      sortable={sortable}
                      disabled={disabled}
                      onRun={() => onRun(command)}
                      onEdit={() => onEdit(command)}
                      onDelete={() => onDelete(command)}
                    />
                  )}
                </SortableItem>
              )
            })}
          </SortableSection>
          {children.length === 0 ? (
            <Typography color="text.secondary" sx={{ fontSize: 12, textAlign: 'center', py: 3 }}>
              {currentFolderId === repo.id ? '这里还没有命令或收藏夹' : '空收藏夹：按住 Ctrl 把命令或收藏夹拖进来'}
            </Typography>
          ) : null}
        </Box>
      </Box>
    </SortableRoot>
  )
}

function PathCrumb({
  folderId,
  label,
  active,
  onNavigate,
}: {
  folderId: string
  label: string
  active: boolean
  onNavigate: () => void
}) {
  return (
    <SortableDropTarget id={`crumb:${folderId}`} targetId={folderId}>
      {(dropRender: SortableDropTargetRenderArgs) => (
        <Button
          ref={dropRender.setNodeRef}
          size="small"
          onClick={event => {
            if (dropRender.shouldSuppressClick()) {
              event.preventDefault()
              return
            }
            onNavigate()
          }}
          sx={{
            minWidth: 0,
            fontWeight: active ? 900 : 700,
            ...(dropRender.isDropTarget
              ? { color: '#ffffff', backgroundColor: '#1976d2', '&:hover': { backgroundColor: '#1976d2' } }
              : null),
            ...(dropRender.isDropCandidate && !dropRender.isDropTarget
              ? { backgroundColor: 'rgba(25, 118, 210, 0.10)' }
              : null),
          }}
        >
          {label}
        </Button>
      )}
    </SortableDropTarget>
  )
}
