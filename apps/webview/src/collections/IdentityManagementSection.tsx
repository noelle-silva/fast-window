import * as React from 'react'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import {
  Box,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Typography,
  alpha,
} from '@mui/material'
import { formatIdentityCreatedAt, identityDisplayName } from './identities'
import type { IdentityInfo } from './types'

/** 设置 · 独立空间登录信息管理：一行一条，点击编辑，可在菜单中删除。 */
export function IdentityManagementSection(props: {
  busy: boolean
  identities: IdentityInfo[]
  onDelete(spaceId: string): void
  onEdit(spaceId: string): void
}) {
  const [menu, setMenu] = React.useState<{ anchor: HTMLElement; spaceId: string } | null>(null)

  return (
    <Paper elevation={0} sx={{ p: 2, borderRadius: 3, bgcolor: theme => alpha(theme.palette.primary.main, 0.06) }}>
      <Stack spacing={1.5}>
        <Box>
          <Typography fontWeight={900}>独立空间登录信息</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
            每条登录信息对应一份独立登录数据；点击条目可编辑名称与描述，删除只清除登录数据，使用它的图标保留独立空间身份。
          </Typography>
        </Box>
        {props.identities.length ? (
          <List disablePadding sx={{ display: 'grid', gap: 1 }}>
            {props.identities.map(identity => (
              <ListItem
                key={identity.spaceId}
                disablePadding
                sx={{ bgcolor: 'background.paper', borderRadius: 2.5 }}
                secondaryAction={(
                  <IconButton
                    edge="end"
                    aria-label="登录信息操作"
                    disabled={props.busy}
                    onClick={event => { event.stopPropagation(); setMenu({ anchor: event.currentTarget, spaceId: identity.spaceId }) }}
                  >
                    <MoreVertRoundedIcon fontSize="small" />
                  </IconButton>
                )}
              >
                <ListItemButton onClick={() => props.onEdit(identity.spaceId)} sx={{ borderRadius: 2.5, pr: 7 }}>
                  <ListItemText
                    primary={<Typography fontWeight={800} noWrap>{identityDisplayName(identity)}</Typography>}
                    secondary={`创建于 ${formatIdentityCreatedAt(identity.createdAtMs)} · ${identity.usedBy.length ? `被 ${identity.usedBy.length} 个图标使用` : '未被图标使用'}`}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        ) : (
          <Typography variant="body2" color="text.secondary">
            还没有独立空间登录信息。新建「独立空间」图标或右键「新建账号身份」后会出现在这里。
          </Typography>
        )}
      </Stack>
      <Menu anchorEl={menu?.anchor ?? null} open={Boolean(menu)} onClose={() => setMenu(null)}>
        <MenuItem
          sx={{ color: 'error.main' }}
          onClick={() => {
            if (!menu) return
            const spaceId = menu.spaceId
            setMenu(null)
            props.onDelete(spaceId)
          }}
        >
          删除
        </MenuItem>
      </Menu>
    </Paper>
  )
}
