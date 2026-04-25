import * as React from 'react'
import { Box, Typography } from '@mui/material'

type Props = {
  accent: string
  accentSoft: string
  icon: React.ReactNode
  title: string
  subtitle?: string
  meta?: string
  onClick?: () => void
  children?: React.ReactNode
}

export function CardFrame(props: Props): React.ReactNode {
  const { accent, accentSoft, icon, title, subtitle, meta, onClick, children } = props
  const clickable = typeof onClick === 'function'

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
        border: '1px solid rgba(15,23,42,.08)',
        bgcolor: '#fff',
        boxShadow: '0 10px 24px rgba(15,23,42,.05)',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'transform .18s ease, box-shadow .18s ease, border-color .18s ease, background-color .18s ease',
        '&:hover': clickable
          ? {
              transform: 'translateY(-1px)',
              borderColor: 'rgba(15,23,42,.14)',
              boxShadow: '0 16px 32px rgba(15,23,42,.10)',
            }
          : undefined,
        '&:focus-visible': clickable
          ? {
              outline: 'none',
              borderColor: accent,
              boxShadow: `0 0 0 3px ${accentSoft}, 0 16px 32px rgba(15,23,42,.10)`,
            }
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
              bgcolor: accentSoft,
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
                color: '#0f172a',
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
                  color: 'rgba(15,23,42,.62)',
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
              bgcolor: 'rgba(15,23,42,.05)',
            }}
          >
            <Typography sx={{ fontSize: 11, lineHeight: 1, fontWeight: 800, color: 'rgba(15,23,42,.58)' }}>{meta}</Typography>
          </Box>
        ) : null}
      </Box>

      {children ? <Box sx={{ minHeight: 0, mt: 'auto' }}>{children}</Box> : null}
    </Box>
  )
}
