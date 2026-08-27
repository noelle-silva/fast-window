import * as React from 'react'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Box } from '@mui/material'
import { CommandCard } from './CommandCard'
import type { AppSettings, CommandItem, Repo, ShellInfo } from '../types'

type CommandListProps = {
  repo: Repo
  commands: CommandItem[]
  settings: AppSettings | null
  shells: ShellInfo[]
  disabled?: boolean
  onRun: (command: CommandItem) => void
  onEdit: (command: CommandItem) => void
  onDelete: (command: CommandItem) => void
  onReorder: (orderedIds: string[]) => Promise<void> | void
}

function SortableCommandCard({
  command,
  repo,
  settings,
  shells,
  onRun,
  onEdit,
  onDelete,
}: {
  command: CommandItem
  repo: Repo
  settings: AppSettings | null
  shells: ShellInfo[]
  onRun: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: command.id })

  return (
    <Box
      ref={setNodeRef}
      sx={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.88 : 1,
        zIndex: isDragging ? 1 : undefined,
      }}
    >
      <CommandCard
        command={command}
        repo={repo}
        settings={settings}
        shells={shells}
        dragHandle={{ attributes, listeners }}
        onRun={onRun}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </Box>
  )
}

export function CommandList({
  repo,
  commands,
  settings,
  shells,
  disabled = false,
  onRun,
  onEdit,
  onDelete,
  onReorder,
}: CommandListProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = commands.findIndex(command => command.id === active.id)
    const newIndex = commands.findIndex(command => command.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    void onReorder(arrayMove(commands, oldIndex, newIndex).map(command => command.id))
  }, [commands, onReorder])

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={commands.map(command => command.id)} strategy={verticalListSortingStrategy} disabled={disabled}>
        <Box className="cr-command-list">
          {commands.map(command => (
            <SortableCommandCard
              key={command.id}
              command={command}
              repo={repo}
              settings={settings}
              shells={shells}
              onRun={() => onRun(command)}
              onEdit={() => onEdit(command)}
              onDelete={() => onDelete(command)}
            />
          ))}
        </Box>
      </SortableContext>
    </DndContext>
  )
}
