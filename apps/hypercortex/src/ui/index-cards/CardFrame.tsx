import * as React from 'react'
import { Box, Typography } from '@mui/material'
import { type HyperCortexToneId, toneFgVar, toneFocusVisibleSx } from '../uiTones'

type Props = {
  tone?: HyperCortexToneId
  danger?: boolean
  icon: React.ReactNode
  title: string
  subtitle?: string
  meta?: string
  onClick?: () => void
  children?: React.ReactNode
}

export function CardFrame(props: Props): React.ReactNode {
  const { tone = 'sage', danger = false, icon, title, subtitle, meta, onClick, children } = props
  const clickable = typeof onClick === 'function'
  const surface = danger ? 'var(--hc-danger-soft)' : 'var(--hc-surface)'
  const surfaceHover = danger ? 'var(--hc-accent-clay)' : 'var(--hc-surface-soft)'
  const accent = danger ? 'var(--hc-danger)' : toneFgVar(tone)

  return (
    <Box
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : -1}
      onKeyDown={
        clickable
          ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
      sx={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 1.25,
        px: 1.6,
        py: 1.45,
        borderRadius: 3.5,
        bgcolor: surface,
        boxShadow: '0 10px 24px var(--hc-shadow)',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'transform .18s ease, box-shadow .18s ease, background-color .18s ease',
        '&:hover': clickable
          ? {
              transform: 'translateY(-1px)',
              boxShadow: '0 16px 32px var(--hc-shadow-strong)',
            }
          : undefined,
        '&:focus-visible': clickable
          ? danger
            ? { outline: 'none', bgcolor: surfaceHover, boxShadow: '0 16px 32px var(--hc-shadow-strong)' }
            : toneFocusVisibleSx(tone, '0 16px 32px var(--hc-shadow-strong)')
          : undefined,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.2 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.2, minWidth: 0, flex: 1 }}>
          <Box
            sx={{
              width: 42,
              height: 42,
              borderRadius: 3,
              bgcolor: 'var(--hc-surface)',
              color: accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              overflow: 'hidden',
            }}
          >
            {icon}
          </Box>

          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              sx={{
                fontSize: 14,
                lineHeight: 1.4,
                fontWeight: 800,
                color: 'var(--hc-text)',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                wordBreak: 'break-word',
              }}
            >
              {title}
            </Typography>
            {subtitle ? (
              <Typography
                sx={{
                  pt: 0.45,
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: 'var(--hc-text-muted)',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  wordBreak: 'break-word',
                }}
              >
                {subtitle}
              </Typography>
            ) : null}
          </Box>
        </Box>

        {meta ? (
          <Box
            sx={{
              flexShrink: 0,
              px: 0.85,
              py: 0.4,
              borderRadius: 999,
              bgcolor: 'var(--hc-surface)',
            }}
          >
            <Typography sx={{ fontSize: 11, lineHeight: 1, fontWeight: 800, color: 'var(--hc-text-subtle)' }}>{meta}</Typography>
          </Box>
        ) : null}
      </Box>

      {children ? <Box sx={{ minHeight: 0, mt: 'auto' }}>{children}</Box> : null}
    </Box>
  )
}
