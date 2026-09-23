import * as React from 'react'
import { Avatar, type SxProps, type Theme } from '@mui/material'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined'
import PersonOutlinedIcon from '@mui/icons-material/PersonOutlined'

export type EntityAvatarKind = 'role' | 'group' | 'workspace'

type EntityAvatarSx = Exclude<Extract<NonNullable<SxProps<Theme>>, ReadonlyArray<unknown>>[number], boolean>

const ENTITY_AVATAR_PRESENTATION: Record<EntityAvatarKind, { icon: React.ElementType; sx: EntityAvatarSx }> = {
  role: { icon: PersonOutlinedIcon, sx: {} },
  group: { icon: GroupsOutlinedIcon, sx: {} },
  workspace: { icon: FolderOutlinedIcon, sx: { bgcolor: 'rgba(59,130,246,.12)', color: 'primary.main' } },
}

export function EntityAvatar(props: { kind: EntityAvatarKind; image?: string; size?: number; sx?: EntityAvatarSx }) {
  const size = Number(props.size || 28)
  const presentation = ENTITY_AVATAR_PRESENTATION[props.kind]
  const Icon = presentation.icon
  const sx: EntityAvatarSx[] = [{ width: size, height: size, fontSize: Math.round(size * 0.62) }, presentation.sx]
  if (props.sx) sx.push(props.sx)
  return (
    <Avatar src={String(props.image || '') || undefined} sx={sx}>
      <Icon fontSize="inherit" />
    </Avatar>
  )
}
