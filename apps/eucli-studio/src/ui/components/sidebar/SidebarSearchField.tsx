import * as React from 'react'
import { Box, IconButton, InputAdornment, TextField } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import SearchIcon from '@mui/icons-material/Search'

// 侧边栏 A 的列表头部：一个搜索框顶替原先的分组标题，全侧边栏只有这一份。
// 框里不写提示文字——提示语随页签变的那套已经退役，剩下放大镜图标自己说明用途；
// 无障碍名单独给，屏幕阅读器照样认得出这是搜索框。
// 底部不留白：紧接的列表自己带头部内边距，间距不在这里叠一层。
export function SidebarSearchField(props: { value: string; onChange: (value: string) => void }) {
  const { value, onChange } = props

  return (
    <Box sx={{ flexShrink: 0, px: 1.5, pt: 1, pb: 0 }}>
      <TextField
        fullWidth
        size="small"
        variant="standard"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputProps={{ 'aria-label': '搜索列表' }}
        InputProps={{
          disableUnderline: true,
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
          endAdornment: value ? (
            <InputAdornment position="end">
              <IconButton size="small" edge="end" aria-label="清空搜索" onClick={() => onChange('')}>
                <CloseIcon fontSize="inherit" />
              </IconButton>
            </InputAdornment>
          ) : null,
        }}
      />
    </Box>
  )
}
