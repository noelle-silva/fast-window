import * as React from 'react'
import { keyframes } from '@emotion/react'
import { Box } from '@mui/material'

const floatPatch = keyframes`
  0%, 100% { transform: translate3d(var(--x), var(--y), 0) rotate(var(--r)); }
  50% { transform: translate3d(calc(var(--x) + 8px), calc(var(--y) - 10px), 0) rotate(calc(var(--r) + 3deg)); }
`

const pulseDot = keyframes`
  0%, 100% { opacity: .52; transform: translate3d(var(--x), var(--y), 0) scale(.94); }
  50% { opacity: .88; transform: translate3d(var(--x), var(--y), 0) scale(1.08); }
`

type Patch = {
  id: string
  x: string
  y: string
  w: number
  h: number
  r: string
  color: string
  opacity: number
}

type Dot = {
  id: string
  x: string
  y: string
  size: number
  color: string
}

const patches: Patch[] = [
  { id: 'sage', x: '-18%', y: '8%', w: 280, h: 180, r: '-8deg', color: 'var(--hc-accent-sage)', opacity: .74 },
  { id: 'sky', x: '58%', y: '-10%', w: 250, h: 170, r: '7deg', color: 'var(--hc-accent-sky)', opacity: .72 },
  { id: 'lavender', x: '70%', y: '54%', w: 220, h: 150, r: '-10deg', color: 'var(--hc-accent-lavender)', opacity: .68 },
  { id: 'clay', x: '8%', y: '64%', w: 210, h: 135, r: '9deg', color: 'var(--hc-accent-clay)', opacity: .62 },
  { id: 'butter', x: '36%', y: '34%', w: 190, h: 120, r: '4deg', color: 'var(--hc-accent-butter)', opacity: .46 },
]

const dots: Dot[] = [
  { id: 'd1', x: '10%', y: '18%', size: 8, color: 'var(--hc-primary)' },
  { id: 'd2', x: '22%', y: '54%', size: 6, color: 'var(--hc-accent-clay)' },
  { id: 'd3', x: '44%', y: '22%', size: 7, color: 'var(--hc-accent-lavender)' },
  { id: 'd4', x: '66%', y: '38%', size: 6, color: 'var(--hc-primary)' },
  { id: 'd5', x: '84%', y: '70%', size: 8, color: 'var(--hc-accent-sky)' },
]

export function HomeNetworkOrbBackground(): React.ReactNode {
  return (
    <Box aria-hidden="true" sx={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', bgcolor: 'var(--hc-surface-soft)' }}>
      {patches.map((patch, index) => (
        <Box
          key={patch.id}
          sx={{
            '--x': patch.x,
            '--y': patch.y,
            '--r': patch.r,
            position: 'absolute',
            left: 0,
            top: 0,
            width: patch.w,
            height: patch.h,
            borderRadius: 8,
            bgcolor: patch.color,
            opacity: patch.opacity,
            animation: `${floatPatch} ${18 + index * 3}s ease-in-out infinite`,
            animationDelay: `${-index * 2}s`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none', transform: `translate3d(${patch.x}, ${patch.y}, 0) rotate(${patch.r})` },
          } as any}
        />
      ))}
      {dots.map((dot, index) => (
        <Box
          key={dot.id}
          sx={{
            '--x': dot.x,
            '--y': dot.y,
            position: 'absolute',
            left: 0,
            top: 0,
            width: dot.size,
            height: dot.size,
            borderRadius: 999,
            bgcolor: dot.color,
            animation: `${pulseDot} ${5 + index * .4}s ease-in-out infinite`,
            animationDelay: `${-index * .35}s`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none', transform: `translate3d(${dot.x}, ${dot.y}, 0)` },
          } as any}
        />
      ))}
      <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(255,250,240,.42)' }} />
    </Box>
  )
}
