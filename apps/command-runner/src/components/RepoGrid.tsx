import * as React from 'react'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Box, Button } from '@mui/material'
import { RepoCard } from './RepoCard'
import type { AppSettings, Repo, ShellInfo } from '../types'

type RepoGridProps = {
  repos: Repo[]
  commands: CommandCountLookup
  settings: AppSettings | null
  shells: ShellInfo[]
  disabled?: boolean
  runningCountFor: (repoId: string) => number
  onOpen: (repo: Repo) => void
  onEdit: (repo: Repo) => void
  onReorder: (orderedIds: string[]) => Promise<void> | void
  onCreateRepo: () => void
}

type CommandCountLookup = {
  countFor: (repoId: string) => number
}

function SortableRepoCard({
  repo,
  commandCount,
  shellName,
  runningCount,
  onOpen,
  onEdit,
}: {
  repo: Repo
  commandCount: number
  shellName: string
  runningCount: number
  onOpen: () => void
  onEdit: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: repo.id })

  return (
    <Box
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      sx={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.88 : 1,
        zIndex: isDragging ? 1 : undefined,
        touchAction: 'none',
      }}
    >
      <RepoCard
        repo={repo}
        commandCount={commandCount}
        shellName={shellName}
        runningCount={runningCount}
        onOpen={onOpen}
        onEdit={onEdit}
      />
    </Box>
  )
}

export function RepoGrid({
  repos,
  commands,
  settings,
  shells,
  disabled = false,
  runningCountFor,
  onOpen,
  onEdit,
  onReorder,
  onCreateRepo,
}: RepoGridProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = repos.findIndex(repo => repo.id === active.id)
    const newIndex = repos.findIndex(repo => repo.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    void onReorder(arrayMove(repos, oldIndex, newIndex).map(repo => repo.id))
  }, [repos, onReorder])

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={repos.map(repo => repo.id)} strategy={rectSortingStrategy} disabled={disabled}>
        <Box className="cr-repo-grid" aria-label="仓库列表">
          {repos.map(repo => (
            <SortableRepoCard
              key={repo.id}
              repo={repo}
              commandCount={commands.countFor(repo.id)}
              shellName={shells.find(shell => shell.id === (repo.shellId || settings?.defaultShellId || 'cmd'))?.name || '默认终端'}
              runningCount={runningCountFor(repo.id)}
              onOpen={() => onOpen(repo)}
              onEdit={() => onEdit(repo)}
            />
          ))}
          {repos.length === 0 ? (
            <Box className="cr-empty-state" sx={{ gridColumn: '1 / -1' }}>
              <Box component="strong" sx={{ fontSize: 14, fontWeight: 900 }}>还没有注册仓库</Box>
              <Box color="text.secondary" sx={{ fontSize: 12 }}>注册本地仓库目录后，就可以按仓库管理命令并一键运行。</Box>
              <Button size="small" variant="contained" onClick={onCreateRepo}>注册仓库</Button>
            </Box>
          ) : null}
        </Box>
      </SortableContext>
    </DndContext>
  )
}
