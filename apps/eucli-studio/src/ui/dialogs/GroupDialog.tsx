import * as React from 'react'
import {
  Avatar,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import SettingsIcon from '@mui/icons-material/Settings'
import { GroupAvatarCropper } from '../components/avatar/GroupAvatarCropper'
import { useEvent } from '../hooks/useEvent'

function clampNum(n: number, min: number, max: number) {
  const x = Number(n)
  if (!isFinite(x)) return min
  if (x < min) return min
  if (x > max) return max
  return x
}

export function GroupDialog(props: { open: boolean; controller: any; roles: any[]; draft: any }) {
  const { open, controller, roles, draft } = props

  const editGroupId = String((draft as any)?.editGroupId || '')
  const isNew = editGroupId === '__new_group__'

  const avatarEmoji = String((draft as any)?.groupAvatar || '').trim() || '👥'
  const avatarImage = String((draft as any)?.groupAvatarImage || '').trim()
  const avatarCropSrc = String((draft as any)?.groupAvatarImageCropSrc || '').trim()

  const mode = String((draft as any)?.groupMode || 'roundRobin') === 'random' ? 'random' : 'roundRobin'
  const members0 = Array.isArray((draft as any)?.groupMemberRoleIds) ? ((draft as any).groupMemberRoleIds as any[]) : []
  const memberRoleIds = members0.map((x) => String(x || '')).filter((x) => !!x)
  const order0 = Array.isArray((draft as any)?.groupRoundRobinOrder) ? ((draft as any).groupRoundRobinOrder as any[]) : []
  const order = order0.map((x) => String(x || '')).filter((x) => !!x)
  const weights = ((draft as any)?.groupRandomWeights && typeof (draft as any).groupRandomWeights === 'object' ? (draft as any).groupRandomWeights : {}) as any
  const minCount = clampNum(Number((draft as any)?.groupRandomMinCount ?? 1), 1, 20)
  const maxCount = clampNum(Number((draft as any)?.groupRandomMaxCount ?? 2), 1, 20)

  const roleById = React.useMemo(() => {
    const m = new Map<string, any>()
    for (const r of roles) {
      const id = String(r?.id || '')
      if (!id || m.has(id)) continue
      m.set(id, r)
    }
    return m
  }, [roles])

  const normalizeOrder = useEvent((nextMembers: string[], rawOrder: string[]) => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const id of rawOrder) {
      if (!id || seen.has(id)) continue
      if (!nextMembers.includes(id)) continue
      seen.add(id)
      out.push(id)
    }
    for (const id of nextMembers) {
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
    return out
  })

  const toggleMember = useEvent((roleId: string) => {
    const rid = String(roleId || '')
    if (!rid) return
    const prev = memberRoleIds.slice()
    const has = prev.includes(rid)
    const nextMembers = has ? prev.filter((x) => x !== rid) : prev.concat([rid])
    controller.actions.setDraft('groupMemberRoleIds', nextMembers)

    const nextOrder = normalizeOrder(nextMembers, order)
    controller.actions.setDraft('groupRoundRobinOrder', nextOrder)

    if (mode === 'random') {
      const nextWeights: any = { ...(weights || {}) }
      if (!has && nextWeights[rid] == null) nextWeights[rid] = 1
      if (has) delete nextWeights[rid]
      controller.actions.setDraft('groupRandomWeights', nextWeights)
    }
  })

  const moveOrder = useEvent((rid: string, delta: number) => {
    const id = String(rid || '')
    if (!id) return
    const list = normalizeOrder(memberRoleIds, order)
    const i = list.findIndex((x) => x === id)
    if (i < 0) return
    const j = i + (delta < 0 ? -1 : 1)
    if (j < 0 || j >= list.length) return
    const next = list.slice()
    const t = next[i]
    next[i] = next[j]
    next[j] = t
    controller.actions.setDraft('groupRoundRobinOrder', next)
  })

  const setWeight = useEvent((rid: string, v: number) => {
    const id = String(rid || '')
    if (!id) return
    const next: any = { ...(weights || {}) }
    next[id] = clampNum(Math.round(Number(v || 0)), 0, 20)
    controller.actions.setDraft('groupRandomWeights', next)
  })

  return (
    <Dialog open={open} onClose={() => controller.actions.closeModal()} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <SettingsIcon fontSize="small" />
        {isNew ? '新建群组' : '群组设置'}
        <Box sx={{ flex: 1 }} />
        <IconButton onClick={() => controller.actions.closeModal()} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              label="群组名"
              value={String((draft as any)?.groupName || '')}
              onChange={(e) => controller.actions.setDraft('groupName', e.target.value)}
              fullWidth
            />
            <TextField
              label="头像（表情，可选）"
              value={String((draft as any)?.groupAvatar || '')}
              onChange={(e) => controller.actions.setDraft('groupAvatar', e.target.value)}
              sx={{ width: { xs: '100%', sm: 200 } }}
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Avatar src={avatarImage || undefined} sx={{ width: 44, height: 44, fontSize: 18 }}>
                {avatarEmoji}
              </Avatar>
              <Typography variant="body2" color="text.secondary">
                头像图片（可选）
              </Typography>
            </Stack>
            <Box sx={{ flex: 1 }} />
            <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ flexWrap: 'wrap' }}>
              <Button variant="outlined" onClick={() => controller.actions.pickGroupAvatarImage?.()} disabled={!!avatarCropSrc}>
                选择图片
              </Button>
              <Button variant="text" onClick={() => controller.actions.clearGroupAvatarImage?.()} disabled={!avatarImage && !avatarCropSrc}>
                清除图片
              </Button>
            </Stack>
          </Stack>

          {avatarCropSrc ? <GroupAvatarCropper controller={controller} src={avatarCropSrc} /> : null}

          <TextField
            label="群聊设定提示词"
            value={String((draft as any)?.groupPrompt || '')}
            onChange={(e) => controller.actions.setDraft('groupPrompt', e.target.value)}
            fullWidth
            multiline
            minRows={4}
            placeholder="这里写入群聊设定：会以系统消息“群聊设定：…”追加到每个角色的系统提示词后面。"
          />

          <FormControl fullWidth>
            <InputLabel>AI 回复运作机制</InputLabel>
            <Select label="AI 回复运作机制" value={mode} onChange={(e) => controller.actions.setDraft('groupMode', e.target.value)}>
              <MenuItem value="roundRobin">轮流模式</MenuItem>
              <MenuItem value="random">随机模式</MenuItem>
            </Select>
          </FormControl>

          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography sx={{ fontWeight: 900 }}>成员角色</Typography>
              <Box sx={{ flex: 1 }} />
              <Typography variant="caption" color="text.secondary">
                已选 {memberRoleIds.length}/{roles.length}
              </Typography>
            </Stack>
            <Divider sx={{ my: 1.25 }} />
            <Stack spacing={0.75}>
              {roles.map((r: any) => {
                const rid = String(r?.id || '')
                const on = memberRoleIds.includes(rid)
                return (
                  <Paper key={rid} variant="outlined" sx={{ px: 1, py: 0.5 }}>
                    <FormControlLabel
                      control={<Checkbox checked={on} onChange={() => toggleMember(rid)} />}
                      label={
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                          <Avatar src={String(r?.avatarImage || '') || undefined} sx={{ width: 22, height: 22, fontSize: 12 }}>
                            {String(r?.avatar || '🙂')}
                          </Avatar>
                          <Typography sx={{ fontWeight: 900 }} noWrap>
                            {String(r?.name || '')}
                          </Typography>
                        </Stack>
                      }
                      sx={{ m: 0 }}
                    />
                  </Paper>
                )
              })}
            </Stack>
          </Paper>

          {mode === 'roundRobin' ? (
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography sx={{ fontWeight: 900, mb: 1 }}>轮流顺序</Typography>
              <Stack spacing={0.75}>
                {normalizeOrder(memberRoleIds, order).map((rid: string) => {
                  const r = roleById.get(rid) || null
                  return (
                    <Paper key={rid} variant="outlined" sx={{ px: 1, py: 0.75 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Avatar src={String(r?.avatarImage || '') || undefined} sx={{ width: 22, height: 22, fontSize: 12 }}>
                          {String(r?.avatar || '🤖')}
                        </Avatar>
                        <Typography sx={{ fontWeight: 900, flex: 1, minWidth: 0 }} noWrap>
                          {String(r?.name || 'AI')}
                        </Typography>
                        <IconButton size="small" onClick={() => moveOrder(rid, -1)}>
                          <ExpandLessIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" onClick={() => moveOrder(rid, +1)}>
                          <ExpandMoreIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </Paper>
                  )
                })}
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                用户发送消息后，按这个顺序依次发言。
              </Typography>
            </Paper>
          ) : (
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography sx={{ fontWeight: 900, mb: 1 }}>随机模式参数</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                <TextField
                  size="small"
                  label="最少参与角色数"
                  type="number"
                  value={String(Math.round(minCount))}
                  onChange={(e) => controller.actions.setDraft('groupRandomMinCount', e.target.value)}
                  inputProps={{ min: 1, max: 20, step: 1 }}
                  fullWidth
                />
                <TextField
                  size="small"
                  label="最多参与角色数"
                  type="number"
                  value={String(Math.round(maxCount))}
                  onChange={(e) => controller.actions.setDraft('groupRandomMaxCount', e.target.value)}
                  inputProps={{ min: 1, max: 20, step: 1 }}
                  fullWidth
                />
              </Stack>

              <Divider sx={{ my: 1.25 }} />
              <Stack spacing={1}>
                {memberRoleIds.map((rid: string) => {
                  const r = roleById.get(rid) || null
                  const w = clampNum(Number(weights?.[rid] ?? 1), 0, 20)
                  return (
                    <Box key={rid}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Avatar src={String(r?.avatarImage || '') || undefined} sx={{ width: 22, height: 22, fontSize: 12 }}>
                          {String(r?.avatar || '🤖')}
                        </Avatar>
                        <Typography sx={{ fontWeight: 900, flex: 1, minWidth: 0 }} noWrap>
                          {String(r?.name || 'AI')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          权重 {Math.round(w)}
                        </Typography>
                      </Stack>
                      <Slider size="small" value={w} min={0} max={20} step={1} onChange={(_e, v) => setWeight(rid, Number(v || 0))} />
                    </Box>
                  )
                })}
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                权重为 0 的角色本轮不会被选中；用户发送消息后，会随机选出若干成员参与回答。
              </Typography>
            </Paper>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => controller.actions.closeModal()}>取消</Button>
        <Button variant="contained" onClick={() => controller.actions.saveGroup?.()} disabled={!!avatarCropSrc}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  )
}

