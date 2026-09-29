import * as React from 'react'
import { Button, Stack, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { SettingsListItem, SettingsPill, SettingsSection } from './SettingsSurfaces'

type ToolConfigFilesSectionProps = {
  controller: any
  tool: any
  tools: any
}

// ToolConfigFilesSection 展示并编辑工具配置区文件：
// 文件列表来自工具详情，内容以原文编辑，保存随工具配置一次提交；
// 界面只做存取展示，不校验内容语义。
export function ToolConfigFilesSection(props: ToolConfigFilesSectionProps) {
  const { controller, tool, tools } = props
  const draft = tools?.configFilesDraft && typeof tools.configFilesDraft === 'object' ? tools.configFilesDraft : {}
  const paths = Object.keys(draft).sort()
  const selected = String(tools?.configFileSelected || '').trim()
  const [newFile, setNewFile] = React.useState('')
  const original = originalConfigPaths(tool)

  const handleAdd = () => {
    const path = newFile.trim()
    if (!path) return
    controller.actions.addConfigFile?.(path)
    setNewFile('')
  }

  return (
    <SettingsSection>
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
          <Typography sx={{ fontWeight: 900 }}>配置文件</Typography>
          <SettingsPill tone="muted">{paths.length} 个文件</SettingsPill>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          工具自己的配置区文件（如运营商配置与适配文件）；保存时随工具配置一起落盘，内容语义由工具解释。
        </Typography>

        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          {paths.map((path) => {
            const active = path === selected
            return (
              <Button key={path} size="small" variant={active ? 'contained' : 'text'} onClick={() => controller.actions.selectConfigFile?.(path)} sx={{ textTransform: 'none' }}>
                {path}
              </Button>
            )
          })}
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <TextField
            size="small"
            label="新增配置文件路径"
            placeholder="例如 providers.json 或 adapters/my-adapter.json"
            value={newFile}
            onChange={(event) => setNewFile(event.target.value)}
            fullWidth
          />
          <Button size="small" startIcon={<AddIcon />} onClick={handleAdd} disabled={!newFile.trim()} sx={{ whiteSpace: 'nowrap' }}>
            新增
          </Button>
        </Stack>

        {selected && draft[selected] !== undefined ? (
          <SettingsListItem sx={{ p: 1 }}>
            <Stack spacing={1}>
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ fontWeight: 900 }}>{selected}</Typography>
                {original.has(selected) ? <SettingsPill>已有文件</SettingsPill> : <SettingsPill tone="info">新文件</SettingsPill>}
                <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => controller.actions.removeConfigFile?.(selected)}>
                  删除
                </Button>
              </Stack>
              <TextField
                label="文件内容"
                value={String(draft[selected] ?? '')}
                onChange={(event) => controller.actions.setConfigFileDraft?.(selected, event.target.value)}
                fullWidth
                multiline
                minRows={8}
                slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 13 } } }}
              />
            </Stack>
          </SettingsListItem>
        ) : (
          <Typography variant="body2" color="text.secondary">选择或新增一个配置文件开始编辑。</Typography>
        )}
      </Stack>
    </SettingsSection>
  )
}

// originalConfigPaths 返回工具详情里原本存在的配置区文件路径集合。
function originalConfigPaths(tool: any): Set<string> {
  const list = Array.isArray(tool?.configFiles) ? tool.configFiles : []
  const paths = new Set<string>()
  for (const item of list) {
    const path = String(item?.path || '').trim()
    if (path) paths.add(path)
  }
  return paths
}
