import * as React from 'react'
import { Box, IconButton, InputBase, Typography } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'

import type { FaceDeclaration, FaceEditViewProps, FaceReadViewProps, FaceViewContext } from '../../facePlugins'
import type { NoteFaceId } from './noteDetailTools'

/**
 * 笔记详情内容区：标题、标签与当前面视窗的渲染。
 * 纯展示组件：编辑状态、内容与动作全部由会话注入。
 */
export type NoteDetailContentAreaProps = {
  bodyScrollRef?: React.Ref<HTMLDivElement>
  editing: boolean
  editTitle: string
  setEditTitle: React.Dispatch<React.SetStateAction<string>>
  noteTitle: string
  editTags: string[]
  onRemoveTag: (tag: string) => void
  tagInput: string
  setTagInput: React.Dispatch<React.SetStateAction<string>>
  onAddTag: () => void
  facesReady: boolean
  faces: NoteFaceId[]
  creatableFaceDeclarations: readonly FaceDeclaration[]
  onAddFace: (kind?: string) => void
  FaceReadView: React.ComponentType<FaceReadViewProps> | null
  FaceEditView: React.ComponentType<FaceEditViewProps> | null
  faceEditing: boolean
  activeContent: { content: string; setContent: (next: string) => void }
  visible: boolean
  faceViewState: Record<string, unknown>
  onFaceViewStateChange: (patch: Record<string, unknown>) => void
  faceViewContext: FaceViewContext
}

function FaceEmptyState(props: { declarations: readonly FaceDeclaration[]; onCreateFace: (kind: string) => void }): React.ReactNode {
  return (
    <Box
      sx={{
        mt: 0.5,
        px: 2,
        py: 5,
        borderRadius: 3,
        bgcolor: 'rgba(15,23,42,.035)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
      }}
    >
      <Typography sx={{ fontSize: 14, lineHeight: 1.6, color: 'rgba(0,0,0,.55)' }}>
        当前笔记没有面，请选择创建一个面
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
        {props.declarations.map(declaration => (
          <Box
            key={declaration.kind}
            role="button"
            tabIndex={0}
            onClick={() => props.onCreateFace(declaration.kind)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                props.onCreateFace(declaration.kind)
              }
            }}
            sx={{
              px: 2,
              py: 1,
              borderRadius: 999,
              bgcolor: '#fff',
              boxShadow: '0 1px 2px rgba(0,0,0,.06)',
              fontSize: 13,
              lineHeight: 1,
              fontWeight: 700,
              color: '#111',
              cursor: 'pointer',
              userSelect: 'none',
              '&:hover': { bgcolor: 'rgba(0,0,0,.04)' },
            }}
          >
            {declaration.label}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

export function NoteDetailContentArea(props: NoteDetailContentAreaProps): React.ReactNode {
  const {
    bodyScrollRef,
    editing,
    editTitle,
    setEditTitle,
    noteTitle,
    editTags,
    onRemoveTag,
    tagInput,
    setTagInput,
    onAddTag,
    facesReady,
    faces,
    creatableFaceDeclarations,
    onAddFace,
    FaceReadView,
    FaceEditView,
    faceEditing,
    activeContent,
    visible,
    faceViewState,
    onFaceViewStateChange,
    faceViewContext,
  } = props

  return (
    <Box ref={bodyScrollRef} sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain', pt: 7 }}>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {editing ? (
        <Box
          sx={{
            minWidth: 0,
            width: '100%',
            mt: 0.5,
            px: 1,
            py: 0.75,
            borderRadius: 3,
            bgcolor: 'rgba(15,23,42,.035)',
          }}
        >
          <InputBase
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            placeholder="输入标题"
            fullWidth
            inputProps={{ 'aria-label': '编辑笔记标题' }}
            sx={{
              fontSize: 28,
              lineHeight: 1.2,
              fontWeight: 900,
              color: '#111',
              '& input': { p: 0 },
            }}
          />
        </Box>
      ) : (
        <Typography sx={{ minWidth: 0, width: '100%', mt: 0.5, fontSize: 28, lineHeight: 1.2, fontWeight: 900, color: '#111' }}>
          {editTitle || noteTitle || '未命名'}
        </Typography>
      )}

      <Box sx={{ width: '100%', display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        {editing ? (
          <>
            {editTags.map(tag => (
              <Box
                key={tag}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  minHeight: 30,
                  pl: 1.25,
                  pr: 0.5,
                  borderRadius: 999,
                  bgcolor: 'rgba(0,0,0,.05)',
                  color: '#374151',
                  fontSize: 12,
                  lineHeight: 1,
                  fontWeight: 600,
                  gap: 0.25,
                }}
              >
                <Box component="span">{tag}</Box>
                <IconButton
                  size="small"
                  aria-label={`删除标签 ${tag}`}
                  onClick={() => onRemoveTag(tag)}
                  sx={{
                    color: 'rgba(0,0,0,.48)',
                    p: 0.35,
                    '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                  }}
                >
                  ×
                </IconButton>
              </Box>
            ))}

            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 30,
                pl: 1.25,
                pr: 0.5,
                borderRadius: 999,
                bgcolor: 'rgba(15,23,42,.045)',
                gap: 0.25,
              }}
            >
              <InputBase
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onAddTag()
                  }
                }}
                placeholder="输入标签"
                inputProps={{ 'aria-label': '输入标签' }}
                sx={{
                  minWidth: 88,
                  fontSize: 12,
                  lineHeight: 1,
                  color: '#374151',
                  '& input': { p: 0 },
                }}
              />
              <IconButton
                size="small"
                aria-label="添加标签"
                onClick={onAddTag}
                sx={{
                  color: 'rgba(0,0,0,.58)',
                  p: 0.35,
                  '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                }}
              >
                <AddRoundedIcon fontSize="inherit" />
              </IconButton>
            </Box>
          </>
        ) : (editTags || []).length > 0 ? (
          editTags.map(tag => (
            <Box
              key={tag}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 28,
                px: 1.25,
                borderRadius: 999,
                bgcolor: 'rgba(0,0,0,.05)',
                color: '#374151',
                fontSize: 12,
                lineHeight: 1,
                fontWeight: 600,
              }}
            >
              {tag}
            </Box>
          ))
        ) : (
          <Typography sx={{ fontSize: 13, lineHeight: 1.5, color: 'rgba(0,0,0,.38)' }}>暂无标签</Typography>
        )}
      </Box>

      {facesReady && faces.length === 0 ? (
        <FaceEmptyState declarations={creatableFaceDeclarations} onCreateFace={kind => void onAddFace(kind)} />
      ) : FaceReadView ? (
        faceEditing && FaceEditView ? (
          <FaceEditView
            content={activeContent.content}
            visible={visible}
            onChange={activeContent.setContent}
            viewState={faceViewState}
            onViewStateChange={onFaceViewStateChange}
            context={faceViewContext}
          />
        ) : (
          <FaceReadView content={activeContent.content} visible={visible} viewState={faceViewState} onViewStateChange={onFaceViewStateChange} context={faceViewContext} />
        )
      ) : (
        <Box sx={{ mt: 0.5, px: 2, py: 5, borderRadius: 3, bgcolor: 'rgba(15,23,42,.035)', textAlign: 'center' }}>
          <Typography sx={{ fontSize: 14, lineHeight: 1.6, color: 'rgba(0,0,0,.55)' }}>
            该面的类型暂不支持显示，内容已原样保留
          </Typography>
        </Box>
      )}

      </Box>
    </Box>
  )
}
