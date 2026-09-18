import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Paper, Popover, Slider, Stack, TextField, Tooltip, Typography } from '@mui/material'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import ImageIcon from '@mui/icons-material/Image'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { clampNum } from '../utils/numbers'

export function ComposerAttachmentsPopovers(props: {
  controller: any
  loading: boolean
  activeRole: any
  attachView: { el: HTMLElement | null; mid: string; idx: number }
  attachViewItem: any
  closeAttachView: () => void
  sendWarn: { open: boolean; items: any[] }
  closeSendWarn: () => void
  attachSendLimitChars: number
  confirmSendWarn: () => void
  attachmentPickerEl: HTMLElement | null
  closeAttachmentPicker: () => void
  onPickDraftImages: () => void
  onPickDraftFiles: () => void
  fileAdjust: { el: HTMLElement | null; id: string }
  closeFileAdjust: () => void
  fileAdjustName: string
  fileAdjustItem: any
  fileAdjustPending: boolean
  fileAdjustError: string
  fileAdjustFullLen: number
  fileAdjustSendLen: number
  fileAdjustPct: number
  fileAdjustTooLong: boolean
  fileAdjustRaw: string
}) {
  const {
    controller,
    loading,
    activeRole,
    attachView,
    attachViewItem,
    closeAttachView,
    sendWarn,
    closeSendWarn,
    attachSendLimitChars,
    confirmSendWarn,
    attachmentPickerEl,
    closeAttachmentPicker,
    onPickDraftImages,
    onPickDraftFiles,
    fileAdjust,
    closeFileAdjust,
    fileAdjustName,
    fileAdjustItem,
    fileAdjustPending,
    fileAdjustError,
    fileAdjustFullLen,
    fileAdjustSendLen,
    fileAdjustPct,
    fileAdjustTooLong,
    fileAdjustRaw,
  } = props

  return (
    <>
      <Popover
        open={!!attachView.el && !!attachViewItem}
        anchorEl={attachView.el}
        onClose={closeAttachView}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ width: 520, maxWidth: '84vw', p: 1.25 }}>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 0.75 }}>
            <Typography sx={{ fontWeight: 900 }}>
              {String(attachViewItem?.attachment?.name || '附件')}
            </Typography>
            <Stack direction="row" spacing={0.5}>
              <Tooltip title="复制文本">
                <IconButton
                  size="small"
                  aria-label="复制附件文本"
                  onClick={() => {
                    const text = String(attachViewItem?.attachment?.text || '')
                    const writeText = controller.capabilities?.clipboard?.writeText
                    if (typeof writeText !== 'function') return controller.capabilities?.ui?.showToast?.('未授权：clipboard.writeText', { kind: 'error' })
                    Promise.resolve()
                      .then(() => writeText(text))
                      .then(() => controller.capabilities?.ui?.showToast?.('已复制', { kind: 'success' }))
                      .catch(() => controller.capabilities?.ui?.showToast?.('复制失败', { kind: 'error' }))
                  }}
                >
                  <ContentCopyIcon fontSize="inherit" />
                </IconButton>
              </Tooltip>
              <Tooltip title="关闭">
                <IconButton size="small" aria-label="关闭附件预览" onClick={closeAttachView}>
                  <CloseIcon fontSize="inherit" />
                </IconButton>
              </Tooltip>
            </Stack>
          </Stack>

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
            将发送：{Math.round(Number(attachViewItem?.attachment?.sendLen ?? 0))}/{Math.round(Number(attachViewItem?.attachment?.fullLen ?? 0))}（
            {clampNum(Math.round(Number(attachViewItem?.attachment?.sendPct ?? 100)), 0, 100)}%）
          </Typography>

          <TextField
            fullWidth
            multiline
            minRows={8}
            maxRows={20}
            size="small"
            value={String(attachViewItem?.attachment?.text || '')}
            inputProps={{ readOnly: true, style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' } }}
          />
        </Box>
      </Popover>

      <Dialog open={sendWarn.open} onClose={closeSendWarn} maxWidth="xs" fullWidth>
        <DialogTitle>附件超长提醒</DialogTitle>
        <DialogContent>
          <Stack spacing={1.25} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              以下附件当前“实际发送长度”超过阈值（{Math.round(attachSendLimitChars)} 字符）。仍然发送可能导致响应慢或消耗更多 token。
            </Typography>
            <Stack spacing={0.75}>
              {sendWarn.items.map((it: any, i: number) => (
                <Paper key={String(it?.id || i)} variant="outlined" sx={{ p: 1 }}>
                  <Typography sx={{ fontWeight: 900 }} noWrap>
                    {String(it?.name || '文件')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    当前发送 {Math.round(Number(it?.pct ?? 100))}%：{Number(it?.sendLen || 0)}/{Number(it?.rawLen || 0)} 字符
                  </Typography>
                </Paper>
              ))}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeSendWarn}>取消</Button>
          <Button variant="contained" color="warning" onClick={confirmSendWarn}>
            仍然发送
          </Button>
        </DialogActions>
      </Dialog>

      <Popover
        open={!!attachmentPickerEl}
        anchorEl={attachmentPickerEl}
        onClose={closeAttachmentPicker}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box data-area="composer-attachment-picker" sx={{ width: 248, p: 1 }}>
          <Stack spacing={0.5}>
            <Button startIcon={<ImageIcon fontSize="small" />} variant="text" onClick={onPickDraftImages} disabled={loading || !activeRole} sx={{ justifyContent: 'flex-start', borderRadius: 2 }}>
              图片
            </Button>
            <Button startIcon={<AttachFileIcon fontSize="small" />} variant="text" onClick={onPickDraftFiles} disabled={loading || !activeRole} sx={{ justifyContent: 'flex-start', borderRadius: 2 }}>
              文件（txt/md/pdf/docx/ppt/pptx）
            </Button>
          </Stack>
        </Box>
      </Popover>

      <Popover
        open={!!fileAdjust.el}
        anchorEl={fileAdjust.el}
        onClose={closeFileAdjust}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box data-area="file-adjust" sx={{ width: 420, p: 1.5 }}>
          <Stack spacing={1.25}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle2" sx={{ fontWeight: 900 }} noWrap>
                附件：{fileAdjustName}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Button size="small" onClick={closeFileAdjust}>
                关闭
              </Button>
            </Stack>

            {!fileAdjustItem ? (
              <Typography variant="body2" color="text.secondary">
                未找到该附件。
              </Typography>
            ) : fileAdjustPending ? (
              <Typography variant="body2" color="text.secondary">
                解析中…
              </Typography>
            ) : fileAdjustError ? (
              <Typography variant="body2" color="error">
                {fileAdjustError}
              </Typography>
            ) : (
              <>
                <Typography variant="caption" color="text.secondary">
                  文件文本长度：{fileAdjustFullLen}；阈值：{attachSendLimitChars}；当前将发送：{fileAdjustSendLen}
                </Typography>

                <Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="body2" sx={{ fontWeight: 900 }}>
                      发送百分比
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <Typography variant="caption" color={fileAdjustTooLong ? 'error' : 'text.secondary'}>
                      {fileAdjustPct}%
                    </Typography>
                  </Stack>
                  <Slider
                    size="small"
                    value={fileAdjustPct}
                    min={0}
                    max={100}
                    step={1}
                    onChange={(_e, v) => controller.actions.setDraftFileSendPct?.(String(fileAdjust.id || ''), v)}
                  />
                  {fileAdjustTooLong ? (
                    <Typography variant="caption" sx={{ color: 'warning.main' }}>
                      超过阈值：点击发送时会弹出确认提醒。
                    </Typography>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      发送时仅取文件开头部分；不会自动截断。超过阈值会在点击发送时提示确认。
                    </Typography>
                  )}
                </Box>

                <Paper variant="outlined" sx={{ bgcolor: 'grey.50' }}>
                  <CustomScrollArea hostSx={{ maxHeight: 200 }} scrollSx={{ maxHeight: 200 }}>
                    <Box sx={{ p: 1 }}>
                      <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                        {(() => {
                          const sendLen = clampNum(fileAdjustSendLen, 0, fileAdjustFullLen)
                          const snippet = fileAdjustRaw.slice(0, sendLen)
                          if (snippet.length <= 4000) return snippet
                          const head = snippet.slice(0, 1500).trimEnd()
                          const tail = snippet.slice(Math.max(0, snippet.length - 1500)).trimStart()
                          return `${head}\n\n…（中间省略 ${Math.max(0, snippet.length - head.length - tail.length)} 字符）…\n\n${tail}`
                        })()}
                      </Typography>
                    </Box>
                  </CustomScrollArea>
                </Paper>
                <Typography variant="caption" color="text.secondary">
                  预览显示“将发送内容”的开头与截断点附近片段（超过 4000 字符会省略中间）。
                </Typography>
              </>
            )}
          </Stack>
        </Box>
      </Popover>
    </>
  )
}
