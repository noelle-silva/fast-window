import { useState } from 'react'
import { Box, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material'
import { publishHostRelease, type HostReleaseBump } from '../host/hostDevActions'
import { IS_HOST_DEV_PROFILE } from '../hostProfile'
import { hostToast } from '../host/hostPrimitives'

type HostDevToolsPanelProps = {
  panelSx: (theme: any) => any
}

const HOST_RELEASE_BUMP_COMMANDS: Array<{ bump: HostReleaseBump; label: string; description: string }> = [
  { bump: 'patch', label: 'Publish Patch', description: '修复版发布，执行 --bump patch' },
  { bump: 'minor', label: 'Publish Minor', description: '功能版发布，执行 --bump minor' },
  { bump: 'major', label: 'Publish Major', description: '大版本发布，执行 --bump major' },
]

function toast(message: string) {
  void hostToast(message)
}

function normalizeVersionInput(value: string): string {
  return value.trim()
}

export default function HostDevToolsPanel({ panelSx }: HostDevToolsPanelProps) {
  const [publishing, setPublishing] = useState(false)
  const [versionInput, setVersionInput] = useState('')

  if (!IS_HOST_DEV_PROFILE) return null

  async function runPublishBump(bump: HostReleaseBump) {
    setPublishing(true)
    try {
      toast(`开始发布宿主：${bump}`)
      await publishHostRelease({ type: 'bump', bump })
      toast(`宿主发布完成：${bump}`)
    } catch (error: any) {
      toast(String(error?.message || error || '宿主发布失败'))
    } finally {
      setPublishing(false)
    }
  }

  async function runPublishVersion() {
    const version = normalizeVersionInput(versionInput)
    if (!version) {
      toast('请先输入版本号')
      return
    }
    setPublishing(true)
    try {
      toast(`开始发布宿主：${version}`)
      await publishHostRelease({ type: 'version', version })
      toast(`宿主发布完成：${version}`)
    } catch (error: any) {
      toast(String(error?.message || error || '宿主发布失败'))
    } finally {
      setPublishing(false)
    }
  }

  return (
    <Stack spacing={1.25}>
      <Box sx={panelSx}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          Dev 工具
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          仅 dev 宿主显示。命令会打开可见终端执行，结束后 5 秒自动关闭。
        </Typography>
      </Box>

      <Box sx={theme => ({ ...panelSx(theme), display: 'flex', flexDirection: 'column', gap: 1 })}>
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            发布宿主发行版
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            执行 pnpm run host:publish，并发布 MSI 与宿主更新目录。发布前请确认 token、仓库和工作区状态。
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          {HOST_RELEASE_BUMP_COMMANDS.map(command => (
            <Button
              key={command.bump}
              size="small"
              variant="contained"
              disabled={publishing}
              onClick={() => void runPublishBump(command.bump)}
              sx={{ boxShadow: 'none' }}
              aria-label={command.description}
            >
              {command.label}
            </Button>
          ))}
        </Stack>

        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <TextField
            size="small"
            label="指定版本"
            value={versionInput}
            onChange={event => setVersionInput(event.target.value)}
            placeholder="例如 1.8.3"
            disabled={publishing}
            helperText="执行 --version x.y.z"
            inputProps={{ 'aria-label': '宿主发布指定版本号' }}
            sx={{ minWidth: 180 }}
          />
          <Button
            size="small"
            variant="outlined"
            disabled={publishing || !normalizeVersionInput(versionInput)}
            onClick={() => void runPublishVersion()}
            sx={{ mt: 0.25 }}
          >
            Publish Version
          </Button>
        </Stack>

        {publishing ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="caption" color="text.secondary">
              宿主发布命令运行中，可在弹出的终端查看进度。
            </Typography>
          </Box>
        ) : null}
      </Box>
    </Stack>
  )
}
