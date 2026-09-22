import * as React from 'react'
import { Button, Stack, TextField, Typography } from '@mui/material'
import { placeholderProblemLabel, type PlaceholderDependencyNode, type PlaceholderProblem } from '../../domain/placeholder'
import { PlaceholderDependencyGraph } from '../components/PlaceholderDependencyGraph'
import { useEvent } from '../hooks/useEvent'
import { PlaceholderEditorDialog } from './PlaceholderEditorDialog'

const PREVIEW_DEBOUNCE_MS = 240

type RoleSystemPromptSectionProps = {
  controller: any
  roleName: string
  value: string
  onChange: (next: string) => void
  placeholders?: any
  systemPlugins?: any
}

export function RoleSystemPromptSection(props: RoleSystemPromptSectionProps) {
  const { controller, roleName, value, onChange, placeholders, systemPlugins } = props
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const [treeOpen, setTreeOpen] = React.useState(false)
  const [tree, setTree] = React.useState<PlaceholderDependencyNode | null>(null)
  const [treeBusy, setTreeBusy] = React.useState(false)
  const [treeError, setTreeError] = React.useState('')
  const [detailName, setDetailName] = React.useState('')

  const rootLabel = String(roleName || '').trim() || '未命名角色'

  React.useEffect(() => {
    if (!previewOpen) return
    const timer = window.setTimeout(() => {
      controller.actions.previewPlaceholders?.(value)?.catch?.(() => null)
    }, PREVIEW_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [controller, previewOpen, value])

  const loadTree = useEvent(() => {
    setTreeBusy(true)
    setTreeError('')
    return Promise.resolve()
      .then(() => controller.actions.loadRolePlaceholderDependencyTree?.(rootLabel, value))
      .then((next: any) => setTree(next || null))
      .catch((e: any) => setTreeError(String(e?.message || e || '生成依赖树失败')))
      .finally(() => setTreeBusy(false))
  })

  React.useEffect(() => {
    if (!treeOpen) return
    void loadTree()
  }, [controller, loadTree, placeholders?.library, rootLabel, treeOpen, value])

  const preview = placeholders?.preview
  const problems: PlaceholderProblem[] = Array.isArray(preview?.problems) ? preview.problems : []
  const treeChildren = Array.isArray(tree?.children) ? tree.children : []

  const toggleTree = () => {
    const next = !treeOpen
    setTreeOpen(next)
    if (next) setPreviewOpen(false)
  }

  const togglePreview = () => {
    const next = !previewOpen
    setPreviewOpen(next)
    if (next) setTreeOpen(false)
  }

  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
          {treeOpen ? '依赖树只用于查看，返回编辑后可继续修改提示词。' : '解析预览只展示占位符替换后的效果，不会改动保存的原文。'}
        </Typography>
        <Button size="small" variant={treeOpen ? 'contained' : 'outlined'} onClick={toggleTree}>
          {treeOpen ? '返回编辑' : '依赖树'}
        </Button>
        <Button size="small" variant={previewOpen ? 'contained' : 'outlined'} onClick={togglePreview}>
          {previewOpen ? '关闭预览' : '解析预览'}
        </Button>
      </Stack>
      {treeOpen ? (
        <Stack spacing={0.75}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ fontWeight: 900 }}>占位符依赖树</Typography>
            {treeBusy ? <Typography variant="caption" color="text.secondary">生成中…</Typography> : null}
          </Stack>
          {treeError ? <Typography variant="body2" color="error.main">{`生成依赖树失败：${treeError}`}</Typography> : null}
          {tree && !treeChildren.length ? (
            <Typography variant="body2" color="text.secondary">系统提示词里还没有引用占位符。</Typography>
          ) : tree ? (
            <>
              <PlaceholderDependencyGraph tree={tree} rootLabel={rootLabel} height={480} onNodeClick={setDetailName} />
              <Typography variant="caption" color="text.secondary">拖拽移动，滚轮缩放；点击占位符节点可编辑并保存。</Typography>
            </>
          ) : (
            <Typography variant="caption" color="text.secondary">{treeBusy ? '正在生成依赖树…' : '暂无依赖树数据。'}</Typography>
          )}
        </Stack>
      ) : (
        <Stack direction={{ xs: 'column', md: previewOpen ? 'row' : 'column' }} spacing={1.5} alignItems="stretch">
          <TextField
            label="系统提示词"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            fullWidth
            multiline
            rows={20}
            placeholder="写入系统提示词…"
            sx={{ flex: 1, minWidth: 0 }}
          />
          {previewOpen ? (
            <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
              <TextField
                label="解析预览"
                value={String(preview?.text ?? '')}
                multiline
                rows={20}
                fullWidth
                placeholder="这里显示占位符替换后的结果…"
                InputProps={{ readOnly: true }}
              />
              {problems.length ? (
                <Typography variant="caption" color="error.main">
                  解析问题：{problems.map((problem) => `${problem.name}：${placeholderProblemLabel(problem.type)}`).join('；')}
                </Typography>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      )}
      <PlaceholderEditorDialog controller={controller} placeholders={placeholders} systemPlugins={systemPlugins} name={detailName} onClose={() => setDetailName('')} />
    </Stack>
  )
}
