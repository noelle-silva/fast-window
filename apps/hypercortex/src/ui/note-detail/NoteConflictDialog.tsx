import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Radio, RadioGroup, Typography } from '@mui/material'

// 冲突三栏窗：左＝你未保存的修改，中＝你改之前的原文（只做对照展示），右＝外部传入的修改。
// 顶部先选其一，再点接受才落盘；不走普通弹窗。
export type NoteConflictDialogProps = {
  open: boolean
  noteTitle: string
  faceLabel: string
  mine: string
  base: string
  external: string
  busy: boolean
  onAccept: (choice: 'mine' | 'external') => void
  onClose: () => void
}

function ConflictColumn(props: { title: string; hint: string; text: string; highlight?: boolean }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 0.5 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'rgba(0,0,0,.72)' }}>{props.title}</Typography>
      <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>{props.hint}</Typography>
      <Box
        component="pre"
        sx={{
          m: 0,
          flex: 1,
          minHeight: 240,
          maxHeight: 420,
          overflow: 'auto',
          p: 1.25,
          borderRadius: 2,
          border: '1px solid',
          borderColor: props.highlight ? 'rgba(34,197,94,.5)' : 'rgba(0,0,0,.1)',
          bgcolor: props.highlight ? 'rgba(34,197,94,.06)' : 'rgba(0,0,0,.02)',
          fontSize: 12,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        }}
      >
        {props.text || '（空）'}
      </Box>
    </Box>
  )
}

export function NoteConflictDialog(props: NoteConflictDialogProps) {
  const { open, noteTitle, faceLabel, mine, base, external, busy, onAccept, onClose } = props
  const [choice, setChoice] = React.useState<'mine' | 'external'>('mine')

  React.useEffect(() => {
    if (open) setChoice('mine')
  }, [open])

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="lg">
      <DialogTitle>外部改动与本地未保存改动冲突</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.72)' }}>
          笔记「{noteTitle}」的当前面（{faceLabel}）既有本地未保存改动，又被外部更新。请先选择保留哪一份，再点接受。
        </Typography>
        <RadioGroup
          row
          value={choice}
          onChange={(_event, value) => setChoice(value as 'mine' | 'external')}
          sx={{ mt: 1, mb: 1 }}
        >
          <FormControlLabel value="mine" control={<Radio size="small" />} label="保留我的修改" />
          <FormControlLabel value="external" control={<Radio size="small" />} label="采用外部修改" />
        </RadioGroup>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1.5, alignItems: 'stretch' }}>
          <ConflictColumn title="我的未保存修改" hint="选择「保留我的」将以此覆盖外部版本" text={mine} highlight={choice === 'mine'} />
          <ConflictColumn title="改前原文" hint="仅作对照展示" text={base} />
          <ConflictColumn title="外部传入的修改" hint="选择「采用外部」将丢弃本地改动" text={external} highlight={choice === 'external'} />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button variant="contained" onClick={() => onAccept(choice)} disabled={busy}>
          接受
        </Button>
      </DialogActions>
    </Dialog>
  )
}
