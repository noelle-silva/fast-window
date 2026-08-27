import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import { Box, Card, CardActionArea, CardContent, Chip, IconButton, Typography } from '@mui/material'
import type { Repo } from '../types'

type RepoCardProps = {
  repo: Repo
  commandCount: number
  shellName: string
  onOpen: () => void
  onEdit: () => void
}

export function RepoCard({ repo, commandCount, shellName, onOpen, onEdit }: RepoCardProps) {
  return (
    <Card className="cr-repo-card" variant="outlined">
      <CardActionArea onClick={onOpen} sx={{ height: '100%', alignItems: 'stretch' }}>
        <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
          <Box sx={{ display: 'flex', width: '100%', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 32, height: 32, flex: '0 0 auto', border: '1px solid', borderColor: 'divider', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'primary.main' }}>
              <FolderOutlinedIcon sx={{ fontSize: 18 }} />
            </Box>
            <Typography component="h2" sx={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 900 }} noWrap>{repo.name}</Typography>
            <IconButton
              size="small"
              aria-label="编辑仓库"
              onClick={event => {
                event.stopPropagation()
                onEdit()
              }}
            >
              <EditOutlinedIcon fontSize="small" />
            </IconButton>
          </Box>
          <Typography color="text.secondary" sx={{ width: '100%', fontSize: 12, lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }}>
            {repo.path}
          </Typography>
          <Box sx={{ mt: 'auto', display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            <Chip size="small" label={`${commandCount} 条命令`} sx={{ fontWeight: 800, bgcolor: 'background.paper' }} />
            <Chip size="small" label={shellName} sx={{ fontWeight: 800, bgcolor: 'background.paper' }} />
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
