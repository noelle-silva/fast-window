import * as React from 'react'
import type { Action } from './App'
import { List, ListItem, ListItemText } from '@mui/material'
import type { Task } from '../model/types'
import { TaskItem } from './TaskItem'

export type TaskTreeProps = {
  tasks: Task[]
  dispatch: React.Dispatch<Action>
  depth?: number
}

export const TaskTree = React.memo(function TaskTree(props: TaskTreeProps) {
  const { tasks, dispatch, depth = 0 } = props

  return (
    <List dense disablePadding sx={{ px: 1 }}>
      {tasks.length === 0 ? (
        <ListItem>
          <ListItemText primary="还没有任务，先从上面加一个吧～" primaryTypographyProps={{ sx: { color: 'text.secondary' } }} />
        </ListItem>
      ) : (
        tasks.map((t) => <TaskItem key={t.id} task={t} dispatch={dispatch} depth={depth} />)
      )}
    </List>
  )
})
