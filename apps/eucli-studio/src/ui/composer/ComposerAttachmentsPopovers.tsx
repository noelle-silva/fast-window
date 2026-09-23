import * as React from 'react'
import { Box, Button, Paper, Popover, Slider, Stack, Typography } from '@mui/material'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import ImageIcon from '@mui/icons-material/Image'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { clampNum } from '../utils/numbers'

export function ComposerAttachmentsPopovers(props: {
  controller: any
  loading: boolean
  activeRole: any
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
  fileAdjustRaw: string
}) {
  const {
    controller,
    loading,
    activeRole,
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
    fileAdjustRaw,
  } = props

  return (
    <>
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
                  文件文本长度：{fileAdjustFullLen}；当前将发送：{fileAdjustSendLen}
                </Typography>

                <Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="body2" sx={{ fontWeight: 900 }}>
                      发送百分比
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <Typography variant="caption" color="text.secondary">
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
                  <Typography variant="caption" color="text.secondary">
                    发送时仅取文件开头部分；不会自动截断。
                  </Typography>
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
