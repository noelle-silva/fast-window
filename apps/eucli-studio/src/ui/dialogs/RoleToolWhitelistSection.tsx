import * as React from 'react'
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import BuildIcon from '@mui/icons-material/Build'
import CloseIcon from '@mui/icons-material/Close'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import SecurityIcon from '@mui/icons-material/Security'
import { normalizeRoleToolPolicy } from '../../domain/toolPolicy'
import { toolCatalogByName, toolCatalogItems, toolDisplayName, type ToolCatalogItem } from '../../domain/toolCatalog'

type RoleToolWhitelistSectionProps = {
  controller: any
  draft: any
  tools: any
}

export function RoleToolWhitelistSection(props: RoleToolWhitelistSectionProps) {
  const { controller, draft, tools } = props
  const policy = normalizeRoleToolPolicy(draft?.roleToolPolicy)
  const catalogItems = toolCatalogItems(tools)
  const catalogByName = React.useMemo<Map<string, ToolCatalogItem>>(() => toolCatalogByName(catalogItems), [catalogItems])
  const [menuAnchor, setMenuAnchor] = React.useState<HTMLElement | null>(null)

  const openToolMenu = (event: React.MouseEvent<HTMLElement>, toolName: string) => {
    setMenuAnchor(event.currentTarget)
    controller.actions.openRoleToolMenu(toolName)
  }

  const closeToolMenu = () => {
    setMenuAnchor(null)
    controller.actions.closeRoleToolMenu()
  }

  return (
    <>
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2.5, bgcolor: 'rgba(25,118,210,.035)' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
            <Box sx={{ width: 42, height: 42, borderRadius: 2, bgcolor: 'rgba(25,118,210,.10)', color: 'primary.main', display: 'grid', placeItems: 'center' }}>
              <SecurityIcon fontSize="small" />
            </Box>
            <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 900 }}>工具白名单</Typography>
                <Typography variant="body2" color="text.secondary">
                只有加入白名单的工具才能被该角色调用；是否传入原生 tools 字段单独配置。
                </Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end" sx={{ flexWrap: 'wrap' }}>
            <Chip size="small" color={policy.tools.length ? 'primary' : 'default'} label={`已加入 ${policy.tools.length} 个`} />
            <Button variant="outlined" onClick={() => controller.actions.openRoleToolWhitelist()}>
              查看/管理
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Dialog open={!!draft?.roleToolWhitelistOpen} onClose={() => controller.actions.closeRoleToolWhitelist()} fullWidth maxWidth="md">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SecurityIcon fontSize="small" />
          工具白名单
          <Typography variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>
            角色：{String(draft?.roleName || '未命名角色')}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <IconButton onClick={() => controller.actions.openRoleToolAdd()} size="small" aria-label="添加工具">
            <AddIcon fontSize="small" />
          </IconButton>
          <IconButton onClick={() => controller.actions.closeRoleToolWhitelist()} size="small" aria-label="关闭工具白名单">
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.25}>
            {policy.tools.length ? (
              policy.tools.map((toolName) => {
                const tool = catalogByName.get(toolName) || { name: toolName, description: '工具目录中暂不可见', type: 'unknown' }
                const mode = policy.runModes[toolName]
                const modeLabel = mode === 'direct' ? '直接运行' : mode === 'ask' ? '运行前询问' : '权限缺失'
                const modeColor = mode === 'direct' ? 'warning' : mode === 'ask' ? 'default' : 'error'
                return (
                  <Paper key={toolName} variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
                    <Stack direction="row" spacing={1.25} alignItems="flex-start">
                      <Box sx={{ width: 38, height: 38, borderRadius: 2, bgcolor: 'grey.100', display: 'grid', placeItems: 'center', color: 'text.secondary' }}>
                        <BuildIcon fontSize="small" />
                      </Box>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                          <Typography sx={{ fontWeight: 900 }}>{toolName}</Typography>
                          {String(tool?.type || '').trim() ? <Chip size="small" variant="outlined" label={String(tool.type)} /> : null}
                          <Chip size="small" color={modeColor} label={modeLabel} />
                        </Stack>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                          {String(tool?.description || '暂无描述')}
                        </Typography>
                      </Box>
                      <IconButton size="small" onClick={(event) => openToolMenu(event, toolName)} aria-label={`管理工具 ${toolName}`}>
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </Paper>
                )
              })
            ) : (
              <Paper variant="outlined" sx={{ p: 3, borderRadius: 2.5, textAlign: 'center', bgcolor: 'grey.50' }}>
                <Typography sx={{ fontWeight: 900 }}>该角色尚未加入任何工具</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  未加入白名单的工具不能被该角色调用，也不能加入原生 tools 传递名单。
                  </Typography>
                <Button startIcon={<AddIcon />} variant="contained" sx={{ mt: 1.5 }} onClick={() => controller.actions.openRoleToolAdd()}>
                  添加工具
                </Button>
              </Paper>
            )}
          </Stack>
        </DialogContent>
      </Dialog>

      <Menu anchorEl={menuAnchor} open={!!menuAnchor && !!draft?.roleToolMenuName} onClose={closeToolMenu}>
        <MenuItem
          onClick={() => {
            const name = String(draft?.roleToolMenuName || '')
            setMenuAnchor(null)
            controller.actions.openRoleToolPermission(name)
          }}
        >
          编辑权限
        </MenuItem>
        <MenuItem
          onClick={() => {
            const name = String(draft?.roleToolMenuName || '')
            setMenuAnchor(null)
            controller.actions.removeRoleTool(name)
          }}
          sx={{ color: 'error.main' }}
        >
          移出白名单
        </MenuItem>
      </Menu>

      <AddRoleToolsDialog controller={controller} draft={draft} tools={tools} policy={policy} />
      <RoleToolPermissionDialog controller={controller} draft={draft} policy={policy} catalogByName={catalogByName} />
    </>
  )
}

function AddRoleToolsDialog(props: { controller: any; draft: any; tools: any; policy: ReturnType<typeof normalizeRoleToolPolicy> }) {
  const { controller, draft, tools, policy } = props
  const catalogItems = toolCatalogItems(tools)
  const selected = Array.isArray(draft?.roleToolAddSelected) ? draft.roleToolAddSelected.map((item: any) => String(item || '').trim()).filter(Boolean) : []
  const selectedSet = new Set(selected)
  const policySet = new Set(policy.tools)
  const query = String(draft?.roleToolSearch || '').trim().toLowerCase()
  const candidates = catalogItems
    .filter((tool: any) => {
      const name = String(tool?.name || tool?.id || '').trim()
      if (!name || policySet.has(name)) return false
      if (!query) return true
      return [name, tool?.description, tool?.type].some((value) => String(value || '').toLowerCase().includes(query))
    })
    .slice(0, 200)

  return (
    <Dialog open={!!draft?.roleToolAddOpen} onClose={() => controller.actions.closeRoleToolAdd()} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <AddIcon fontSize="small" />
        添加工具
        <Box sx={{ flex: 1 }} />
        <IconButton onClick={() => controller.actions.closeRoleToolAdd()} size="small" aria-label="关闭添加工具">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <TextField
            label="搜索工具"
            placeholder="搜索工具名、描述或类型"
            value={String(draft?.roleToolSearch || '')}
            onChange={(event) => controller.actions.setRoleToolSearch(event.target.value)}
            fullWidth
          />
          {tools?.loading ? <Typography variant="body2" color="text.secondary">工具列表加载中...</Typography> : null}
          {tools?.error ? <Typography variant="body2" color="error">{String(tools.error || '')}</Typography> : null}
          <Stack spacing={1}>
            {candidates.length ? (
              candidates.map((tool: any) => {
                const name = toolDisplayName(tool)
                return (
                  <Paper key={name} variant="outlined" sx={{ p: 1.25, borderRadius: 2, cursor: 'pointer' }} onClick={() => controller.actions.toggleRoleToolAddSelection(name)}>
                    <Stack direction="row" spacing={1.25} alignItems="flex-start">
                      <Checkbox checked={selectedSet.has(name)} sx={{ mt: -0.5 }} />
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                          <Typography sx={{ fontWeight: 900 }}>{name}</Typography>
                          {String(tool?.type || '').trim() ? <Chip size="small" variant="outlined" label={String(tool.type)} /> : null}
                        </Stack>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                          {String(tool?.description || '暂无描述')}
                        </Typography>
                      </Box>
                    </Stack>
                  </Paper>
                )
              })
            ) : (
              <Paper variant="outlined" sx={{ p: 3, borderRadius: 2.5, textAlign: 'center', bgcolor: 'grey.50' }}>
                <Typography sx={{ fontWeight: 900 }}>没有可加入的工具</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  可用工具为空，或搜索结果都已经在白名单里。
                </Typography>
              </Paper>
            )}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => controller.actions.closeRoleToolAdd()}>取消</Button>
        <Button variant="contained" onClick={() => controller.actions.addSelectedRoleTools()} disabled={!selected.length}>
          加入白名单
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function RoleToolPermissionDialog(props: { controller: any; draft: any; policy: ReturnType<typeof normalizeRoleToolPolicy>; catalogByName: Map<string, ToolCatalogItem> }) {
  const { controller, draft, policy, catalogByName } = props
  const toolName = String(draft?.roleToolPermissionName || '').trim()
  const tool = catalogByName.get(toolName) || null
  const mode = policy.runModes[toolName]
  return (
    <Dialog open={!!toolName} onClose={() => controller.actions.closeRoleToolPermission()} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <SecurityIcon fontSize="small" />
        编辑工具权限
        <Box sx={{ flex: 1 }} />
        <IconButton onClick={() => controller.actions.closeRoleToolPermission()} size="small" aria-label="关闭权限编辑">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Box>
            <Typography sx={{ fontWeight: 900 }}>{toolName || '工具'}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {String(tool?.description || '选择该工具在角色运行中的执行方式。')}
            </Typography>
          </Box>
          <Stack spacing={1}>
            <PermissionChoice
              selected={mode === 'ask'}
              title="运行前询问"
              description="模型请求该工具时先等待用户确认。适合 shell_command 等高权限工具。"
              onClick={() => controller.actions.setRoleToolRunMode(toolName, 'ask')}
            />
            <PermissionChoice
              selected={mode === 'direct'}
              title="直接运行"
              description="模型请求该工具时直接执行，不再逐次确认。请只给可信工具开启。"
              warning
              onClick={() => controller.actions.setRoleToolRunMode(toolName, 'direct')}
            />
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

function PermissionChoice(props: { selected: boolean; title: string; description: string; warning?: boolean; onClick: () => void }) {
  const { selected, title, description, warning, onClick } = props
  return (
    <Paper
      variant="outlined"
      onClick={onClick}
      sx={{
        p: 1.5,
        borderRadius: 2,
        cursor: 'pointer',
        borderColor: selected ? (warning ? 'warning.main' : 'primary.main') : 'divider',
        bgcolor: selected ? (warning ? 'rgba(237,108,2,.08)' : 'rgba(25,118,210,.08)') : 'background.paper',
      }}
    >
      <Typography sx={{ fontWeight: 900 }}>{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {description}
      </Typography>
    </Paper>
  )
}
