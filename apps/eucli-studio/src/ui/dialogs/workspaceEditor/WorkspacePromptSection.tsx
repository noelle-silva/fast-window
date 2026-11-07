import * as React from 'react'
import { Button, Stack, Typography } from '@mui/material'
import { CategoryEditorSection } from '../../components/categoryEditor/CategoryEditorSection'
import { FillTextarea } from '../../components/FillTextarea'

/** 打开预览后稍等一拍再请求：来回连点切换时只留最后一次。 */
const PREVIEW_REFRESH_DEBOUNCE_MS = 200

/**
 * 工作区提示词：这一屏锁死高度，不产生外层滚动。
 * 编辑态让提示词文本框吃掉剩余空间；预览态换成后台生成的实际提示词（只读）。
 * 预览没有手动刷新：每次打开预览都重新生成一次，最新结果自动落到这里。
 */
export function WorkspacePromptSection(props: { controller: any; draft: any }) {
  const { controller, draft } = props
  const [previewOpen, setPreviewOpen] = React.useState(false)

  const prompt = String(draft?.workspacePrompt || '')
  const actualPrompt = String(draft?.workspaceActualPrompt || '')
  const actualPromptLoading = Boolean(draft?.workspaceActualPromptLoading)
  const actualPromptError = String(draft?.workspaceActualPromptError || '')

  React.useEffect(() => {
    if (!previewOpen) return
    const timer = window.setTimeout(() => {
      controller.actions.refreshWorkspacePromptPreview?.()
    }, PREVIEW_REFRESH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [controller, previewOpen])

  return (
    <CategoryEditorSection
      fill
      title="工作区提示词"
      description="这里写入项目约定与工作规范；实际提示词由后台生成，打开预览即自动生成最新结果。"
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
        <Typography
          variant="caption"
          color={actualPromptError ? 'error.main' : 'text.secondary'}
          sx={{ flex: 1, minWidth: 0 }}
        >
          {previewOpen
            ? actualPromptError ||
              (actualPromptLoading ? '正在生成实际提示词…' : '实际提示词按当前工作区资料生成，只读预览，不会改动保存的原文。')
            : '描述只是备注，不会进入提示词；想影响模型请写这里。'}
        </Typography>
        <Button size="small" variant={previewOpen ? 'contained' : 'outlined'} onClick={() => setPreviewOpen(!previewOpen)}>
          {previewOpen ? '返回编辑' : '实际提示词'}
        </Button>
      </Stack>

      {previewOpen ? (
        <FillTextarea
          label="实际提示词"
          value={actualPrompt || '（当前没有额外工作区提示词会进入对话）'}
          readOnly
        />
      ) : (
        <FillTextarea
          label="工作区提示词"
          value={prompt}
          onChange={(next) => controller.actions.setDraft?.('workspacePrompt', next)}
          placeholder="这里写入项目约定、工作规范、额外上下文说明。"
        />
      )}
    </CategoryEditorSection>
  )
}
