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
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { normalizeRoleToolPolicy } from '../../domain/toolPolicy'
import { toolCatalogByName, toolCatalogItems, toolDisplayName, type ToolCatalogItem } from '../../domain/toolCatalog'
import { MoreActionsMenu } from '../components/MoreActionsMenu'

type RoleToolsSectionProps = {
  controller: any
  draft: any
  tools: any
}

const toggleGroupSx = {
  p: 0.25,
  borderRadius: 2,
  bgcolor: 'rgba(15,23,42,.05)',
  '& .MuiToggleButtonGroup-grouped': {
    border: 0,
    mx: 0,
    px: 1,
    py: 0.25,
    fontSize: 12,
    lineHeight: 1.6,
    textTransform: 'none' as const,
    color: 'text.secondary',
    borderRadius: 1.5,
    '&.Mui-selected': {
      color: 'text.primary',
      bgcolor: 'rgba(255,255,255,.96)',
      boxShadow: '0 2px 10px rgba(15,23,42,.12)',
    },
    '&.Mui-selected:hover': { bgcolor: '#fff' },
  },
}

export function RoleToolsSection(props: RoleToolsSectionProps) {
  const { controller, draft, tools } = props
  const policy = normalizeRoleToolPolicy(draft?.roleToolPolicy)
  const catalogItems = toolCatalogItems(tools)
  const catalogByName = React.useMemo<Map<string, ToolCatalogItem>>(() => toolCatalogByName(catalogItems), [catalogItems])

  React.useEffect(() => {
    controller.actions.refreshTools?.(false)
  }, [controller])

  return (
    <Stack spacing={1.25}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
          加入白名单的工具才能被该角色调用；每个工具可单独设置执行方式与是否传递工具提示词。
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
          <Chip size="small" color={policy.tools.length ? 'primary' : 'default'} label={`已加入 ${policy.tools.length} 个`} />
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => controller.actions.openRoleToolAdd()}>
            添加工具
          </Button>
        </Stack>
      </Stack>

      {policy.tools.length ? (
        <Stack spacing={0.75}>
          {policy.tools.map((toolName) => {
            const tool = catalogByName.get(toolName)
            const mode = policy.runModes[toolName] || null
            const passPrompt = policy.nativeTools.includes(toolName)
            return (
              <Paper key={toolName} elevation={0} sx={{ px: 1, py: 0.75, borderRadius: 2, bgcolor: 'rgba(255,255,255,.72)' }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 900 }} noWrap>
                      {toolName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                      {String(tool?.description || '工具目录中暂不可见')}
                    </Typography>
                  </Box>

                  <Tooltip title="执行方式：询问=运行前先等待确认；直接=不再逐次确认">
                    <ToggleButtonGroup
                      size="small"
                      exclusive
                      value={mode}
                      sx={toggleGroupSx}
                      onChange={(_e, next) => {
                        if (next) controller.actions.setRoleToolRunMode(toolName, next)
                      }}
                    >
                      <ToggleButton value="ask">询问</ToggleButton>
                      <ToggleButton value="direct">直接</ToggleButton>
                    </ToggleButtonGroup>
                  </Tooltip>

                  <Tooltip title="是否把该工具的原生提示词写入供应商 tools 字段">
                    <ToggleButtonGroup
                      size="small"
                      exclusive
                      value={passPrompt ? 'pass' : 'keep'}
                      sx={toggleGroupSx}
                      onChange={(_e, next) => {
                        if (next === 'pass') controller.actions.addRoleNativeTool(toolName)
                        else if (next === 'keep') controller.actions.removeRoleNativeTool(toolName)
                      }}
                    >
                      <ToggleButton value="pass">传提示词</ToggleButton>
                      <ToggleButton value="keep">不传</ToggleButton>
                    </ToggleButtonGroup>
                  </Tooltip>

                  <MoreActionsMenu
                    ariaLabel={`工具 ${toolName} 更多操作`}
                    items={[{
                      key: 'remove',
                      label: '从白名单删除工具',
                      icon: <DeleteOutlineIcon fontSize="small" />,
                      danger: true,
                      confirm: {
                        title: '确认从白名单删除工具？',
                        description: `将把「${toolName}」从该角色白名单移除，保存角色后生效。`,
                      },
                      onSelect: () => controller.actions.removeRoleTool(toolName),
                    }]}
                  />
                </Stack>
              </Paper>
            )
          })}
        </Stack>
      ) : (
        <Paper elevation={0} sx={{ p: 3, borderRadius: 2.5, textAlign: 'center', bgcolor: 'rgba(255,255,255,.6)' }}>
          <Typography sx={{ fontWeight: 900 }}>该角色尚未加入任何工具</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            未加入白名单的工具不能被该角色调用，也不能传递工具提示词。
          </Typography>
          <Button startIcon={<AddIcon />} variant="contained" sx={{ mt: 1.5 }} onClick={() => controller.actions.openRoleToolAdd()}>
            添加工具
          </Button>
        </Paper>
      )}

      <RoleToolAddDialog controller={controller} draft={draft} tools={tools} policy={policy} />
    </Stack>
  )
}

function RoleToolAddDialog(props: { controller: any; draft: any; tools: any; policy: ReturnType<typeof normalizeRoleToolPolicy> }) {
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
        <Button onClick={() => controller.actions.closeRoleToolAdd()} size="small">
          关闭
        </Button>
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
