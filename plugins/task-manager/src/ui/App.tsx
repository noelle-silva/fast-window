import * as React from 'react'
import { AppBar, Box, CssBaseline, Toolbar, Typography } from '@mui/material'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import type { Task, TaskData } from '../model/types'
import { createEmptyTaskData } from '../model/types'
import { loadTasks, saveTasks, addTask, removeTask, toggleCollapsed, toggleDone, updateTask } from '../store/taskStore'
import { AddTaskInput } from './AddTaskInput'
import { TaskTree } from './TaskTree'

export type Action =
  | { type: 'hydrate'; data: TaskData }
  | { type: 'addTask'; parentId: string | null; title: string }
  | { type: 'removeTask'; taskId: string }
  | { type: 'toggleDone'; taskId: string }
  | { type: 'toggleCollapsed'; taskId: string }
  | { type: 'updateTask'; taskId: string; updates: Partial<Pick<Task, 'title' | 'description'>> }

function reducer(state: TaskData, action: Action): TaskData {
  switch (action.type) {
    case 'hydrate':
      return action.data
    case 'addTask':
      return addTask(state, action.parentId, action.title)
    case 'removeTask':
      return removeTask(state, action.taskId)
    case 'toggleDone':
      return toggleDone(state, action.taskId)
    case 'toggleCollapsed':
      return toggleCollapsed(state, action.taskId)
    case 'updateTask':
      return updateTask(state, action.taskId, action.updates)
    default:
      return state
  }
}

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#4CAF50' },
  },
})

export const App = React.memo(function App() {
  const [state, dispatch] = React.useReducer(reducer, undefined, () => createEmptyTaskData())
  const hydratedRef = React.useRef(false)

  React.useEffect(() => {
    let cancelled = false
    void loadTasks().then((data) => {
      if (cancelled) return
      dispatch({ type: 'hydrate', data })
      hydratedRef.current = true
    })
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    // 约定：任何一次 dispatch 导致的 state 变化，都自动持久化
    if (!hydratedRef.current) return
    void saveTasks(state).catch(() => {})
  }, [state])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Toolbar sx={{ gap: 2 }}>
            <Typography variant="h6" sx={{ fontSize: 16, fontWeight: 700, flexShrink: 0 }}>
              任务管理
            </Typography>
            <Box sx={{ flex: 1, minWidth: 0, maxWidth: 520 }}>
              <AddTaskInput
                onAdd={(title) => dispatch({ type: 'addTask', parentId: null, title })}
                onCancel={() => {}}
              />
            </Box>
          </Toolbar>
        </AppBar>

        <Box sx={{ flex: 1, overflow: 'auto', py: 1 }}>
          <TaskTree tasks={state.tasks} dispatch={dispatch} />
        </Box>
      </Box>
    </ThemeProvider>
  )
})
