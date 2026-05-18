import { Box, Button, TextField, Typography } from '@mui/material'
import type { AssetEntry } from '../assetTypes'
import { assetRefKey } from '../assetTypes'

type Props = {
  asset: AssetEntry
  displayName: string
  remark: string
  tagsText: string
  saving: boolean
  dirty: boolean
  onDisplayNameChange: (value: string) => void
  onRemarkChange: (value: string) => void
  onTagsTextChange: (value: string) => void
  onSave: () => void
}

export function AssetInfoSidebar(props: Props) {
  const { asset } = props
  return (
    <Box aria-label="附件信息侧边栏" sx={{ width: '100%', p: 2, boxSizing: 'border-box' }}>
      <Typography sx={{ fontSize: 12, fontWeight: 900, color: 'rgba(0,0,0,.55)', mb: 1 }}>
        附件信息
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <MetaBlock label="附件引用" value={assetRefKey(asset)} mono />
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75 }}>
          <MetaPill label="大小" value={humanAssetSize(asset.size)} />
          <MetaPill label="上传" value={formatAssetDate(asset.uploadedAtMs)} />
          <MetaPill label="类型" value={asset.mime || asset.kind || '未知'} />
          <MetaPill label="修改" value={formatAssetDate(asset.modifiedMs)} />
        </Box>
        <MetaBlock label="来源名" value={asset.sourceName || asset.fileName || '—'} />
      </Box>

      <Box sx={{ my: 1.5, borderTop: '1px solid rgba(0,0,0,.08)' }} />

      <Typography sx={{ fontSize: 12, fontWeight: 900, color: 'rgba(0,0,0,.55)', mb: 1 }}>
        可编辑元数据
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <TextField
          label="显示名"
          size="small"
          value={props.displayName}
          onChange={e => props.onDisplayNameChange(e.target.value)}
          inputProps={{ maxLength: 180, 'aria-label': '编辑附件显示名' }}
        />
        <TextField
          label="备注"
          multiline
          minRows={4}
          value={props.remark}
          onChange={e => props.onRemarkChange(e.target.value)}
          inputProps={{ maxLength: 2000, 'aria-label': '编辑附件备注' }}
        />
        <TextField
          label="标签"
          size="small"
          value={props.tagsText}
          onChange={e => props.onTagsTextChange(e.target.value)}
          placeholder="用逗号分隔"
          inputProps={{ 'aria-label': '编辑附件标签' }}
        />
        <Button
          variant="contained"
          size="small"
          onClick={props.onSave}
          disabled={!props.dirty || props.saving}
          sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 900 }}
        >
          {props.saving ? '保存中...' : '保存附件信息'}
        </Button>
      </Box>
    </Box>
  )
}

function MetaBlock({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.42)', mb: 0.5 }}>{label}</Typography>
      <Typography
        component={mono ? 'code' : 'div'}
        sx={{
          display: 'block',
          fontSize: 12,
          color: '#111',
          fontWeight: 700,
          fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' : undefined,
          wordBreak: 'break-all',
          whiteSpace: 'pre-wrap',
        }}
      >
        {value || '—'}
      </Typography>
    </Box>
  )
}

function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ px: 1, py: 0.75, borderRadius: 2, bgcolor: 'rgba(15,23,42,.04)' }}>
      <Typography sx={{ fontSize: 10, color: 'rgba(15,23,42,.45)', fontWeight: 800 }}>{label}</Typography>
      <Typography sx={{ mt: 0.25, fontSize: 12, color: '#0f172a', fontWeight: 900, wordBreak: 'break-word' }}>{value}</Typography>
    </Box>
  )
}

function humanAssetSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatAssetDate(ms: number | undefined): string {
  const n = Number(ms || 0)
  if (!Number.isFinite(n) || n <= 0) return '—'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(n))
  } catch {
    return new Date(n).toLocaleString()
  }
}
