import AssignmentTurnedInOutlinedIcon from '@mui/icons-material/AssignmentTurnedInOutlined'
import { Box, Card, CardActionArea, CardContent, Chip, Typography } from '@mui/material'
import type { TaskBoard } from '../types'

type TaskBoardCardProps = {
  board: TaskBoard
  onOpen: () => void
}

export function TaskBoardCard({ board, onOpen }: TaskBoardCardProps) {
  return (
    <Card className="tm-board-card" variant="outlined">
      <CardActionArea onClick={onOpen} sx={{ height: '100%', alignItems: 'stretch' }}>
        <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
          <Box sx={{ width: 32, height: 32, border: '1px solid', borderColor: 'divider', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'primary.main' }}>
            <AssignmentTurnedInOutlinedIcon sx={{ fontSize: 18 }} />
          </Box>
          <Typography component="h2" sx={{ width: '100%', fontSize: 16, fontWeight: 900 }} noWrap>{board.title}</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 12, lineHeight: 1.5, display: '-webkit-box', overflow: 'hidden', WebkitBoxOrient: 'vertical', WebkitLineClamp: 3 }}>
            {board.description || '没有描述'}
          </Typography>
          <Chip size="small" label={`${board.tasks.length} 条任务`} sx={{ mt: 'auto', fontWeight: 800, bgcolor: 'background.paper' }} />
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
