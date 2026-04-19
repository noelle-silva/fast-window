import * as React from 'react'
import { Add as AddIcon, ChevronRight, Delete as DeleteIcon, ExpandMore } from '@mui/icons-material'
import {
  Box,
  Checkbox,
  Collapse,
  IconButton,
  ListItem,
  ListItemIcon,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material'
import type { Task } from '../model/types'
import { AddTaskInput } from './AddTaskInput'
import type { Action } from './App'
import { TaskTree } from './TaskTree'

export type TaskItemProps = {
  task: Task
  dispatch: React.Dispatch<Action>
  depth: number
}

export const TaskItem = React.memo(function TaskItem(props: TaskItemProps) {
  const { task, dispatch, depth } = props

  const hasChildren = task.children.length > 0

  const [addingChild, setAddingChild] = React.useState(false)

  const [editingTitle, setEditingTitle] = React.useState(false)
  const [draftTitle, setDraftTitle] = React.useState(task.title)

  React.useEffect(() => setDraftTitle(task.title), [task.title])

  const [editingDesc, setEditingDesc] = React.useState(false)
  const [draftDesc, setDraftDesc] = React.useState(task.description)
  React.useEffect(() => setDraftDesc(task.description), [task.description])

  const commitTitle = React.useCallback(() => {
    setEditingTitle(false)
    const next = draftTitle.trim()
    if (!next || next === task.title) {
      setDraftTitle(task.title)
      return
    }
    dispatch({ type: 'updateTask', taskId: task.id, updates: { title: next } })
  }, [dispatch, draftTitle, task.id, task.title])

  const cancelTitle = React.useCallback(() => {
    setEditingTitle(false)
    setDraftTitle(task.title)
  }, [task.title])

  const commitDesc = React.useCallback(() => {
    setEditingDesc(false)
    const next = draftDesc.trim()
    if (next === task.description) return
    dispatch({ type: 'updateTask', taskId: task.id, updates: { description: next } })
  }, [dispatch, draftDesc, task.description, task.id])

  const cancelDesc = React.useCallback(() => {
    setEditingDesc(false)
    setDraftDesc(task.description)
  }, [task.description])

  const toggleAddChild = React.useCallback(() => {
    setAddingChild((v) => {
      const next = !v
      if (next && task.collapsed) {
        dispatch({ type: 'toggleCollapsed', taskId: task.id })
      }
      return next
    })
  }, [dispatch, task.collapsed, task.id])

  const showCollapse = hasChildren || addingChild
  const collapseIn = (!task.collapsed && hasChildren) || addingChild

  return (
    <>
      <ListItem
        disableGutters
        sx={{
          pl: depth * 3,
          pr: 1,
          borderRadius: 1,
          '&:hover': { bgcolor: 'action.hover' },
          '& .TaskItem-actions': { opacity: 0, transition: 'opacity 120ms ease' },
          '&:hover .TaskItem-actions': { opacity: 1 },
        }}
        secondaryAction={
          <Box className="TaskItem-actions" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <IconButton size="small" onClick={toggleAddChild} aria-label="添加子任务">
              <AddIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={() => dispatch({ type: 'removeTask', taskId: task.id })}
              aria-label="删除任务"
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        }
      >
        <Box sx={{ width: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {hasChildren ? (
            <IconButton
              size="small"
              onClick={() => dispatch({ type: 'toggleCollapsed', taskId: task.id })}
              aria-label={task.collapsed ? '展开' : '折叠'}
            >
              {task.collapsed ? <ChevronRight fontSize="small" /> : <ExpandMore fontSize="small" />}
            </IconButton>
          ) : null}
        </Box>

        <ListItemIcon sx={{ minWidth: 36 }}>
          <Checkbox
            edge="start"
            size="small"
            checked={task.done}
            onChange={() => dispatch({ type: 'toggleDone', taskId: task.id })}
            inputProps={{ 'aria-label': '完成' }}
          />
        </ListItemIcon>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          {editingTitle ? (
            <TextField
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              autoFocus
              size="small"
              variant="standard"
              fullWidth
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitTitle()
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  cancelTitle()
                }
              }}
              sx={{ '& .MuiInputBase-input': { fontSize: 14 } }}
            />
          ) : editingDesc ? (
            <Box sx={{ py: 0.5 }}>
              <Typography
                variant="body2"
                onClick={() => {
                  setEditingDesc(false)
                  setEditingTitle(true)
                }}
                sx={{
                  cursor: 'text',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  textDecoration: task.done ? 'line-through' : 'none',
                  opacity: task.done ? 0.55 : 1,
                }}
              >
                {task.title}
              </Typography>
              <TextField
                value={draftDesc}
                onChange={(e) => setDraftDesc(e.target.value)}
                autoFocus
                size="small"
                variant="standard"
                fullWidth
                multiline
                minRows={2}
                onBlur={commitDesc}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    cancelDesc()
                    return
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    commitDesc()
                  }
                }}
                sx={{
                  '& .MuiInputBase-input': {
                    fontSize: 12,
                    color: 'text.secondary',
                  },
                }}
              />
            </Box>
          ) : (
            <ListItemText
              primary={task.title}
              secondary={task.description ? task.description : '添加描述...'}
              primaryTypographyProps={{
                onClick: () => {
                  setEditingDesc(false)
                  setEditingTitle(true)
                },
                sx: {
                  cursor: 'text',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  textDecoration: task.done ? 'line-through' : 'none',
                  opacity: task.done ? 0.55 : 1,
                },
              }}
              secondaryTypographyProps={{
                onClick: () => {
                  setEditingTitle(false)
                  setEditingDesc(true)
                },
                sx: {
                  cursor: 'text',
                  userSelect: 'none',
                  opacity: task.done ? 0.4 : task.description ? 0.85 : 0.5,
                  fontStyle: task.description ? 'normal' : 'italic',
                  whiteSpace: 'pre-wrap',
                },
              }}
            />
          )}
        </Box>
      </ListItem>

      {showCollapse ? (
        <Collapse in={collapseIn} timeout="auto" unmountOnExit>
          {addingChild ? (
            <Box sx={{ px: 1, pl: (depth + 1) * 3, pr: 2, pb: 1 }}>
              <AddTaskInput
                onAdd={(title) => {
                  dispatch({ type: 'addTask', parentId: task.id, title })
                  setAddingChild(false)
                }}
                onCancel={() => setAddingChild(false)}
              />
            </Box>
          ) : null}

          {hasChildren ? <TaskTree tasks={task.children} dispatch={dispatch} depth={depth + 1} /> : null}
        </Collapse>
      ) : null}
    </>
  )
})
