import * as React from 'react'
import { Button, Stack, Typography } from '@mui/material'
import { CategoryEditorSection } from '../../components/categoryEditor/CategoryEditorSection'
import { FillTextarea } from '../../components/FillTextarea'

/**
 * 工作区提示词：平时只有原文一栏。
 * 点「实际提示词」当场发刷新请求、同时展开右侧只读栏（双视图）；再点一下收起。
 * 这一屏锁死高度，不产生外层滚动；展开时左右各占一半，窄屏自动上下堆叠。
 */
export function WorkspacePromptSection(props: { controller: any; draft: any }) {
  const { controller, draft } = props
  const [previewOpen, setPreviewOpen] = React.useState(false)

  const prompt = String(draft?.workspacePrompt || '')
  const actualPrompt = String(draft?.workspaceActualPrompt || '')
  const actualPromptLoading = Boolean(draft?.workspaceActualPromptLoading)
  const actualPromptError = String(draft?.workspaceActualPromptError || '')

  // 展开即刷新：点按钮这一下就发请求，走的是按钮本身，不靠定时器补一次。
  const togglePreview = () => {
    if (previewOpen) {
      setPreviewOpen(false)
      return
    }
    controller.actions.refreshWorkspacePromptPreview?.()
    setPreviewOpen(true)
  }

  return (
    <CategoryEditorSection
      fill
      title="工作区提示词"
      description="平时只显示原文；要核对后台拼装结果时展开实际提示词。"
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
        <Typography
          variant="caption"
          color={actualPromptError ? 'error.main' : 'text.secondary'}
          sx={{ flex: 1, minWidth: 0 }}
        >
          {previewOpen
            ? actualPromptError ||
              (actualPromptLoading ? '正在生成实际提示词…' : '实际提示词按当前工作区资料生成，只读展示，不会改动保存的原文。')
            : '描述只是备注，不会进入提示词；想影响模型请写这里。'}
        </Typography>
        <Button size="small" variant={previewOpen ? 'contained' : 'outlined'} onClick={togglePreview}>
          {previewOpen ? '返回编辑' : '实际提示词'}
        </Button>
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ flex: '1 1 auto', minHeight: 0 }}>
        <FillTextarea
          label="工作区提示词"
          value={prompt}
          onChange={(next) => controller.actions.setDraft?.('workspacePrompt', next)}
          placeholder="这里写入项目约定、工作规范、额外上下文说明。"
        />
        {previewOpen ? (
          <FillTextarea
            label="实际提示词"
            value={actualPrompt || '（当前没有额外工作区提示词会进入对话）'}
            readOnly
          />
        ) : null}
      </Stack>
    </CategoryEditorSection>
  )
}
