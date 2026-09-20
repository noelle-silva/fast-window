import * as React from 'react'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import { useCopyFeedback } from '../clipboard'
import { placeholderReference } from '../placeholders'
import type { Placeholder } from '../types'

type RepoPlaceholderReferenceProps = {
  placeholders: Placeholder[]
  disabled?: boolean
}

// RepoPlaceholderReference 以三列网格只读展示仓库级占位符：每格一个引用文本与复制按钮。
// 仓库级占位符在仓库设置里维护，这里只做命令编辑时的快速引用入口；没有可引用项时整块不出现。
export function RepoPlaceholderReference({ placeholders, disabled = false }: RepoPlaceholderReferenceProps) {
  const { copiedKey, copy } = useCopyFeedback()

  if (placeholders.length === 0) return null

  return (
    <Box className="cr-repo-placeholder-reference">
      <Box className="cr-placeholder-editor-head">
        <Typography component="h3" sx={{ fontSize: 13, fontWeight: 900 }}>仓库级占位符</Typography>
        <Typography color="text.secondary" sx={{ fontSize: 12 }}>点击复制引用，粘贴进命令脚本</Typography>
      </Box>
      <Box className="cr-repo-placeholder-grid">
        {placeholders.map(item => {
          const reference = placeholderReference(item.name)
          return (
            <Box key={item.name} className="cr-repo-placeholder-cell">
              <Box component="code" className="cr-placeholder-ref">{reference}</Box>
              <Tooltip title={copiedKey === item.name ? '已复制' : '复制引用'}>
                <span>
                  <IconButton
                    size="small"
                    disabled={disabled}
                    aria-label={`复制 ${reference}`}
                    onClick={() => void copy(item.name, reference)}
                  >
                    {copiedKey === item.name ? <CheckIcon fontSize="small" color="success" /> : <ContentCopyIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
