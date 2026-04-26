import * as React from 'react'
import { keyframes } from '@emotion/react'
import { Box } from '@mui/material'

const waveDrift = keyframes`
  0% { transform: perspective(860px) rotateX(58deg) rotateZ(-14deg) translate3d(-4%, -18%, 0); }
  100% { transform: perspective(860px) rotateX(58deg) rotateZ(-14deg) translate3d(-4%, 18%, 0); }
`

const waveDriftReverse = keyframes`
  0% { transform: perspective(900px) rotateX(60deg) rotateZ(-14deg) translate3d(8%, 16%, -120px); }
  100% { transform: perspective(900px) rotateX(60deg) rotateZ(-14deg) translate3d(8%, -16%, -120px); }
`

const dashFlow = keyframes`
  0% { stroke-dashoffset: 0; }
  100% { stroke-dashoffset: -220; }
`

const pulseNode = keyframes`
  0%, 100% { opacity: .32; transform: scale(.82); }
  50% { opacity: .82; transform: scale(1.18); }
`

const lineRows = [
  '20,154 92,118 165,132 238,86 310,108 384,62 458,86 532,44 606,66 680,30',
  '4,218 78,182 150,196 224,150 298,172 372,124 446,150 520,102 594,126 704,82',
  '26,284 100,250 174,264 248,218 322,238 396,192 470,216 544,170 618,194 690,154',
  '12,350 86,316 160,330 234,286 308,306 382,260 456,284 530,238 604,262 704,220',
]

const nodeRows = [
  [20, 154, 92, 118, 165, 132, 238, 86, 310, 108, 384, 62, 458, 86, 532, 44, 606, 66, 680, 30],
  [4, 218, 78, 182, 150, 196, 224, 150, 298, 172, 372, 124, 446, 150, 520, 102, 594, 126, 704, 82],
  [26, 284, 100, 250, 174, 264, 248, 218, 322, 238, 396, 192, 470, 216, 544, 170, 618, 194, 690, 154],
  [12, 350, 86, 316, 160, 330, 234, 286, 308, 306, 382, 260, 456, 284, 530, 238, 604, 262, 704, 220],
]

function WaveLayer(props: { reverse?: boolean; opacity: number; delay: number }): React.ReactNode {
  const { reverse, opacity, delay } = props
  return (
    <Box
      sx={{
        position: 'absolute',
        inset: '-46% -22%',
        opacity,
        transformStyle: 'preserve-3d',
        animation: `${reverse ? waveDriftReverse : waveDrift} ${reverse ? 18 : 22}s linear infinite`,
        animationDelay: `${delay}s`,
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }}
    >
      <Box
        component="svg"
        viewBox="0 0 720 420"
        preserveAspectRatio="none"
        sx={{ width: '100%', height: '100%', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id={reverse ? 'hc-wave-line-r' : 'hc-wave-line'} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="rgba(83, 168, 255, 0)" />
            <stop offset=".42" stopColor="rgba(95, 201, 255, .72)" />
            <stop offset="1" stopColor="rgba(166, 128, 255, 0)" />
          </linearGradient>
        </defs>

        {lineRows.map((points, idx) => (
          <polyline
            key={points}
            points={points}
            fill="none"
            stroke={`url(#${reverse ? 'hc-wave-line-r' : 'hc-wave-line'})`}
            strokeWidth={idx % 2 ? 1.2 : 1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="10 18"
            style={{ animation: `${dashFlow} ${8 + idx * 2}s linear infinite`, animationDelay: `${delay - idx}s` }}
          />
        ))}

        {nodeRows.map((row, rowIdx) => (
          <React.Fragment key={rowIdx}>
            {row.map((value, idx) => {
              if (idx % 2) return null
              const x = value
              const y = row[idx + 1]
              return (
                <circle
                  key={`${rowIdx}-${idx}`}
                  cx={x}
                  cy={y}
                  r={rowIdx % 2 ? 2.1 : 2.7}
                  fill="rgba(210, 238, 255, .88)"
                  style={{ transformOrigin: `${x}px ${y}px`, animation: `${pulseNode} ${3.4 + rowIdx * .35}s ease-in-out infinite`, animationDelay: `${delay - idx * .08}s` }}
                />
              )
            })}
          </React.Fragment>
        ))}
      </Box>
    </Box>
  )
}

export function HomeNetworkWaveBackground(): React.ReactNode {
  return (
    <Box aria-hidden="true" sx={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <Box sx={{ position: 'absolute', inset: 0, bgcolor: '#07111f' }} />
      <Box sx={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 20% 18%, rgba(55,151,255,.45), transparent 32%), radial-gradient(circle at 78% 20%, rgba(146,95,255,.32), transparent 32%), linear-gradient(135deg, #07111f 0%, #10233b 52%, #090c18 100%)' }} />
      <WaveLayer opacity={0.88} delay={0} />
      <WaveLayer reverse opacity={0.44} delay={-7} />
      <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(7,17,31,.68) 0%, rgba(7,17,31,.18) 48%, rgba(7,17,31,.42) 100%)' }} />
      <Box sx={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px)', backgroundSize: '42px 42px', opacity: .28 }} />
    </Box>
  )
}
