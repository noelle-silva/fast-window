import * as React from 'react'
import { Box, Paper, Stack, Typography } from '@mui/material'
import StarIcon from '@mui/icons-material/Star'
import { formatModelRefDisplayText } from '../../domain/modelRefUtils'
import { modelCandidateKey, type RoleModelCandidate } from '../../domain/roleModelCandidates'

// 候选模型列表：角色编辑与临时模型弹窗共用同一份呈现。
// 差异只在「哪个候选被高亮」与「右侧操作」，由调用方注入，不在组件内分叉。
export function RoleModelCandidateList(props: {
  candidates: RoleModelCandidate[]
  providers: any[]
  modelGroups: any[]
  highlightedKey?: string
  highlightLabel?: string
  onSelect?: (candidate: RoleModelCandidate, key: string) => void
  renderTrailing?: (candidate: RoleModelCandidate, key: string, highlighted: boolean) => React.ReactNode
  emptyHint: string
}) {
  const { candidates, providers, modelGroups, highlightedKey, highlightLabel, onSelect, renderTrailing, emptyHint } = props

  if (!candidates.length) {
    return (
      <Stack direction="row" spacing={1} alignItems="center">
        <StarIcon fontSize="small" sx={{ opacity: 0.35 }} />
        <Typography variant="body2" color="text.secondary">
          {emptyHint}
        </Typography>
      </Stack>
    )
  }

  return (
    <Stack spacing={1}>
      {candidates.map((candidate) => {
        const key = modelCandidateKey(candidate)
        const highlighted = key === String(highlightedKey || '')
        return (
          <Paper
            key={key}
            elevation={0}
            onClick={onSelect ? () => onSelect(candidate, key) : undefined}
            sx={{
              p: 1,
              borderRadius: 2,
              bgcolor: 'var(--studio-paper-muted)',
              border: highlighted ? '1px solid var(--studio-primary)' : '1px solid transparent',
              cursor: onSelect ? 'pointer' : 'default',
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
                  {formatModelRefDisplayText(candidate, providers, modelGroups) || candidate.modelId}
                </Typography>
                {highlighted && highlightLabel ? (
                  <Typography variant="caption" color="text.secondary">
                    {highlightLabel}
                  </Typography>
                ) : null}
              </Box>
              {renderTrailing ? renderTrailing(candidate, key, highlighted) : null}
            </Stack>
          </Paper>
        )
      })}
    </Stack>
  )
}
